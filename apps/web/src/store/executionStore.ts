/**
 * executionStore.ts — Zustand store for per-workflow execution state.
 *
 * Extracted from CanvasPage.tsx (Fix 6) so that components subscribe only
 * to the slice they need rather than re-rendering on any canvas change.
 *
 * Owns:
 * - Per-node execution state (status, input, output, error, durationMs,
 *   itemCount, binary, expressionErrors), keyed by nodeId.
 * - Active execution metadata (executionId, banner text, cancelling flag).
 * - Socket connection lifecycle helpers (initSocket / destroySocket).
 *
 * CanvasPage still manages node/edge React Flow state — this store only
 * tracks the *execution overlay* data that components like
 * NodeInspectPopover and ExpressionEditorInput subscribe to.
 */

import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import { toast } from './toastStore';

// ─── Node-level execution state ────────────────────────────────────────────

export type NodeExecStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped' | 'paused';

export interface NodeExecState {
  status: NodeExecStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  durationMs?: number;
  itemCount?: number;
  binary?: unknown;
  expressionErrors?: { param: string; message: string; type: string }[];
}

// ─── Store shape ────────────────────────────────────────────────────────────

export interface ExecutionState {
  /** Per-node execution state, keyed by nodeId. Cleared on execution:started. */
  nodeStates: Record<string, NodeExecState>;

  /** The executionId for the currently-running execution, or null. */
  activeExecutionId: string | null;

  /** Human-readable banner text shown in the canvas header. */
  runBanner: string | null;

  /** True while a cancel request is in flight (debounces double-clicks). */
  cancelling: boolean;

  // ─── Derived selectors ───────────────────────────────────────────────────

  /** Get the execution state for a single node (defaults to idle). */
  getNodeState: (nodeId: string) => NodeExecState;

  // ─── Mutators (called by socket handlers and CanvasPage) ─────────────────

  setNodeState: (nodeId: string, updates: Partial<NodeExecState>) => void;
  resetAllNodes: () => void;
  setActiveExecutionId: (id: string | null) => void;
  setRunBanner: (text: string | null) => void;
  setCancelling: (v: boolean) => void;

  // ─── Socket lifecycle ────────────────────────────────────────────────────

  /**
   * Initialise a Socket.IO connection for the given workflowId.
   * Safe to call multiple times — re-uses the existing socket if workflowId
   * hasn't changed, and tears down + reconnects if it has.
   *
   * @param accessToken JWT to authenticate the socket handshake.
   * @param workflowId  The workflow whose events we want to receive.
   * @param userId      Current user id — used to filter presence events.
   * @param onEdgesActive Optional callback so CanvasPage can animate edges
   *   (edge state lives in ReactFlow, not here).
   * @param onPresence  Optional callback for presence viewer updates.
   * @param onCursor    Optional callback for remote cursor events.
   */
  initSocket: (
    accessToken: string,
    workflowId: string,
    userId: string | undefined,
    onEdgesActive?: (nodeId: string, active: boolean) => void,
    onPresence?: (viewers: { userId: string; email: string; color: string }[]) => void,
    onCursor?: (userId: string, x: number, y: number) => void,
  ) => Socket;

  /** Disconnect and clear the current socket. */
  destroySocket: () => void;

  /** Emit a presence:cursor event (throttled externally by CanvasPage). */
  emitCursor: (workflowId: string, x: number, y: number) => void;

  /** Internal — current socket instance. */
  _socket: Socket | null;
  /** Internal — workflowId the current socket is scoped to. */
  _boundWorkflowId: string | null;
}

// ─── Store implementation ───────────────────────────────────────────────────

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  nodeStates: {},
  activeExecutionId: null,
  runBanner: null,
  cancelling: false,
  _socket: null,
  _boundWorkflowId: null,

  getNodeState: (nodeId: string): NodeExecState => {
    return get().nodeStates[nodeId] ?? { status: 'idle' };
  },

  setNodeState: (nodeId: string, updates: Partial<NodeExecState>) => {
    set((s) => ({
      nodeStates: {
        ...s.nodeStates,
        [nodeId]: { ...(s.nodeStates[nodeId] ?? { status: 'idle' }), ...updates },
      },
    }));
  },

  resetAllNodes: () => {
    set({ nodeStates: {} });
  },

  setActiveExecutionId: (id) => set({ activeExecutionId: id }),
  setRunBanner: (text) => set({ runBanner: text }),
  setCancelling: (v) => set({ cancelling: v }),

  initSocket: (accessToken, workflowId, userId, onEdgesActive, onPresence, onCursor) => {
    const { _socket, _boundWorkflowId, destroySocket } = get();

    // Re-use the existing socket if we're already connected for this workflow.
    if (_socket && _boundWorkflowId === workflowId) return _socket;

    // Tear down the previous socket (different workflow or stale).
    if (_socket) destroySocket();

    const socket = io(import.meta.env.VITE_API_URL ?? 'http://localhost:4000', {
      path: '/ws/executions',
      auth: { token: accessToken },
      transports: ['websocket'],
    });

    // ── Execution-level events ──────────────────────────────────────────────

    socket.on('execution:started', (e: any) => {
      if (e.workflowId !== workflowId) return;
      get().resetAllNodes();
      set({ runBanner: 'Execution running…', activeExecutionId: e.executionId ?? null });
    });

    socket.on('node:started', (e: any) => {
      if (e.workflowId !== workflowId) return;
      get().setNodeState(e.nodeId, {
        status: 'running',
        input: e.input,
        itemCount: e.itemCount,
        binary: e.binary,
      });
      onEdgesActive?.(e.nodeId, true);
    });

    socket.on('node:completed', (e: any) => {
      if (e.workflowId !== workflowId) return;
      get().setNodeState(e.nodeId, {
        status: 'success',
        output: e.output,
        durationMs: e.durationMs,
        itemCount: e.itemCount,
        error: undefined,
        binary: e.binary,
        expressionErrors: e.expressionErrors,
      });
      onEdgesActive?.(e.nodeId, false);
    });

    socket.on('node:failed', (e: any) => {
      if (e.workflowId !== workflowId) return;
      get().setNodeState(e.nodeId, {
        status: 'failed',
        error: e.error,
        durationMs: e.durationMs,
      });
      onEdgesActive?.(e.nodeId, false);
    });

    socket.on('node:skipped', (e: any) => {
      if (e.workflowId !== workflowId) return;
      get().setNodeState(e.nodeId, { status: 'skipped' });
      onEdgesActive?.(e.nodeId, false);
    });

    socket.on('execution:completed', (e: any) => {
      if (e.workflowId !== workflowId) return;
      set({ runBanner: 'Execution finished — see history for details.', activeExecutionId: null, cancelling: false });
      setTimeout(() => set({ runBanner: null }), 4000);
      if (e.status === 'failed') {
        toast.error('Execution failed');
      } else {
        toast.success('Execution finished');
      }
    });

    socket.on('execution:cancelled', (e: any) => {
      if (e.workflowId !== workflowId) return;
      set({ runBanner: 'Execution cancelled.', activeExecutionId: null, cancelling: false });
      setTimeout(() => set({ runBanner: null }), 4000);
      toast.info('Execution cancelled');
    });

    socket.on('execution:paused', (e: any) => {
      if (e.workflowId !== workflowId) return;
      set({ runBanner: 'Execution paused — waiting…' });
      if (e.nodeId) get().setNodeState(e.nodeId, { status: 'paused' });
    });

    socket.on('node:webhook-response', (e: any) => {
      if (e.workflowId !== workflowId) return;
      if (e.nodeId) get().setNodeState(e.nodeId, { status: 'success', output: e.output });
      toast.info('Respond to Webhook node fired');
    });

    // ── Presence events ────────────────────────────────────────────────────

    socket.emit('presence:join', { workflowId });

    socket.on('presence:viewers', (e: { workflowId: string; viewers: { userId: string; email: string; color: string }[] }) => {
      if (e.workflowId !== workflowId) return;
      onPresence?.(e.viewers.filter((v) => v.userId !== userId));
    });

    socket.on('presence:cursor', (e: { workflowId: string; userId: string; x: number; y: number }) => {
      if (e.workflowId !== workflowId || e.userId === userId) return;
      onCursor?.(e.userId, e.x, e.y);
    });

    set({ _socket: socket, _boundWorkflowId: workflowId });
    return socket;
  },

  destroySocket: () => {
    const { _socket, _boundWorkflowId } = get();
    if (_socket) {
      if (_boundWorkflowId) _socket.emit('presence:leave', { workflowId: _boundWorkflowId });
      _socket.disconnect();
    }
    set({ _socket: null, _boundWorkflowId: null });
  },

  emitCursor: (workflowId: string, x: number, y: number) => {
    const { _socket } = get();
    _socket?.emit('presence:cursor', { workflowId, x, y });
  },
}));

// ─── Convenience selectors (stable references for selective subscription) ──

/** Subscribe to just one node's execution state without re-rendering on others. */
export function useNodeExecState(nodeId: string): NodeExecState {
  return useExecutionStore((s) => s.nodeStates[nodeId] ?? { status: 'idle' });
}
