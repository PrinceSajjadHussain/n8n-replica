import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { io, type Socket } from 'socket.io-client';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import FlowNode, { type FlowNodeData, type NodeStatus } from '../components/FlowNode';
import StickyNoteNode from '../components/StickyNoteNode';
import GroupNode from '../components/GroupNode';
import CommandPalette, { type CommandItem } from '../components/CommandPalette';
import { autoLayout } from '../lib/autoLayout';
import NodePalette from '../components/NodePalette';
import { NODE_TYPES } from '../lib/nodeTypeMeta';
import NodeConfigPanel from '../components/NodeConfigPanel';
import { NodeDensityContext, CredentialNamesContext, NODE_DENSITY_OPTIONS, type NodeDensity } from '../lib/nodeDensity';
import { isScheduleCronValid } from '../components/Paramform';
import CollabPanel from '../components/CollabPanel';
import ConfirmDialog from '../components/ConfirmDialog';
import { useIsMobile } from '../lib/useMediaQuery';
import MobileExecutionMonitorPage from './MobileExecutionMonitorPage';
import { toast } from '../store/toastStore';
import PelletEdge from '../components/PelletEdge';
import ExecutionScrubber, { type ExecutionSummary, type HistoryNodeRun } from '../components/ExecutionScrubber';
import { getNodePorts, CONNECTION_TYPE_META, NodeConnectionTypes } from '../lib/connectionTypes';
import { serializeEdgesForSave, deriveEdgesFromSaved } from '../lib/edgeSerialization';
import { CanvasHandleAddContext, type HandleAddRequest } from '../lib/canvasHandleContext';
import { NodeRetryContext } from '../lib/nodeRetryContext';

const nodeTypes = { flowNode: FlowNode, stickyNote: StickyNoteNode, group: GroupNode };
const edgeTypes = { default: PelletEdge };
let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `node_${Date.now()}_${idCounter}`;
}

export default function CanvasPage() {
  // Below the `sm` breakpoint, hand off to the read-only mobile monitor —
  // the drag/connect/resize interactions here assume a mouse and a wide
  // canvas, neither of which a phone viewport can offer usefully.
  const isMobile = useIsMobile();
  if (isMobile) return <MobileExecutionMonitorPage />;
  return <CanvasPageDesktop />;
}

function CanvasPageDesktop() {
  const { id: workflowId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);

  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  /**
   * Execution-lifecycle notifications (run started/finished/failed/cancelled,
   * webhook fired, cancel/retry errors) are scoped to THIS canvas — rendered
   * inside the canvas viewport itself, not the app-global <ToastViewport />.
   * Using local component state (not the shared toastStore) means they're
   * automatically gone the instant this page unmounts, so they can never
   * leak onto the Workflows list or any other page after you navigate away.
   */
  const [canvasToasts, setCanvasToasts] = useState<
    { id: string; message: string; variant: 'success' | 'error' | 'info' }[]
  >([]);
  const pushCanvasToast = useCallback(
    (message: string, variant: 'success' | 'error' | 'info' = 'info', duration = 3500) => {
      const id = `ctoast_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      setCanvasToasts((cur) => [...cur, { id, message, variant }]);
      if (duration > 0) {
        setTimeout(() => setCanvasToasts((cur) => cur.filter((t) => t.id !== id)), duration);
      }
    },
    []
  );
  const [credentials, setCredentials] = useState<
    { id: string; type: string; name?: string; lastTestOk?: boolean | null }[]
  >([]);
  const credentialNames = useMemo(
    () => Object.fromEntries(credentials.map((c) => [c.id, c.name || c.type])),
    [credentials]
  );
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [density, setDensity] = useState<NodeDensity>(() => {
    // Canvas UI state only — deliberately kept out of nodesPayload/handleSave
    // so it never touches the saved workflow JSON. Persisted per-browser via
    // localStorage purely so switching tabs doesn't reset it.
    try {
      return (localStorage.getItem('flowforge:node-density') as NodeDensity) || 'comfortable';
    } catch {
      return 'comfortable';
    }
  });
  function changeDensity(next: NodeDensity) {
    setDensity(next);
    try {
      localStorage.setItem('flowforge:node-density', next);
    } catch {
      // localStorage unavailable — density just won't persist across reloads.
    }
  }
  const [runBanner, setRunBanner] = useState<string | null>(null);
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [replayExecution, setReplayExecution] = useState<ExecutionSummary | null>(null);
  const [replayNodeRuns, setReplayNodeRuns] = useState<Record<string, HistoryNodeRun> | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [collabOpen, setCollabOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** Set when a handle's "+" affordance is clicked — the next node added from
   *  the palette gets auto-wired to this exact handle instead of dropped bare. */
  const [pendingHandleRequest, setPendingHandleRequest] = useState<HandleAddRequest | null>(null);

  // Node types that can actually plug into the pending handle: same matching
  // rule as addNode() below — a "+" clicked on a source (output) handle needs
  // a new node with a compatible INPUT, a "+" on a target (input) handle
  // needs a compatible OUTPUT. `undefined` when nothing's pending, which
  // tells NodePalette to show everything at full opacity as usual.
  const compatiblePaletteTypes = useMemo(() => {
    if (!pendingHandleRequest) return undefined;
    const wantedType = pendingHandleRequest.port.type;
    const set = new Set<string>();
    for (const n of NODE_TYPES) {
      const ports = getNodePorts(n.type);
      const candidatePorts = pendingHandleRequest.handleType === 'source' ? ports.inputs : ports.outputs;
      if (candidatePorts.some((p) => p.type === wantedType)) set.add(n.type);
    }
    return set;
  }, [pendingHandleRequest]);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  const [presenceViewers, setPresenceViewers] = useState<{ userId: string; email: string; color: string }[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, { x: number; y: number; color: string; email: string }>>({});
  const historyRef = useRef<{ past: Array<{ nodes: Node<FlowNodeData>[]; edges: Edge[] }>; future: Array<{ nodes: Node<FlowNodeData>[]; edges: Edge[] }> }>({
    past: [],
    future: [],
  });
  const skipHistoryRef = useRef(false);

  const refreshCredentials = useCallback(async () => {
    const { data: credData } = await api.get('/credentials');
    setCredentials(credData.credentials);
  }, []);

  // Load workflow + credentials (reusable for initial load and Discard Changes)
  const loadWorkflow = useCallback(async () => {
    if (!workflowId) return;
    const [{ data: wfData }, { data: credData }] = await Promise.all([
      api.get(`/workflows/${workflowId}`),
      api.get('/credentials'),
    ]);
    setCredentials(credData.credentials);
    const wf = wfData.workflow;
    // Reset selection and history before setting new state so undo can't go back to a discarded draft
    setSelectedNodeId(null);
    historyRef.current = { past: [], future: [] };
    setName(wf.name);
    setIsActive(wf.isActive);
    setNodes(
      (wf.nodesJson as any[]).map((n) => {
        if (n.type === 'stickyNote') {
          return {
            id: n.id,
            type: 'stickyNote',
            position: n.position ?? { x: 100, y: 100 },
            style: n.style ?? { width: 200, height: 140 },
            parentId: n.parentId ?? undefined,
            extent: n.extent === 'parent' ? ('parent' as const) : undefined,
            data: { label: n.label ?? 'Note', text: n.params?.text ?? '', color: n.params?.color },
          };
        }
        if (n.type === 'group') {
          return {
            id: n.id,
            type: 'group',
            position: n.position ?? { x: 100, y: 100 },
            style: n.style ?? { width: 240, height: 160 },
            data: { label: n.label ?? 'Group' },
          };
        }
        return {
          id: n.id,
          type: 'flowNode',
          position: n.position ?? { x: 100, y: 100 },
          parentId: n.parentId ?? undefined,
          extent: n.extent === 'parent' ? ('parent' as const) : undefined,
          data: {
            label: n.label ?? n.type,
            nodeType: n.type,
            status: 'idle' as NodeStatus,
            params: n.params ?? {},
            credentialId: n.credentialId ?? null,
            retry: n.retry ?? null,
            continueOnFail: n.continueOnFail ?? false,
            isPinned: n.isPinned ?? false,
            pinnedOutput: n.pinnedOutput,
            notes: n.notes ?? null,
          },
        };
      })
    );
    const nodeTypeById = new Map<string, string | undefined>((wf.nodesJson as any[]).map((n) => [n.id, n.type]));
    setEdges(deriveEdgesFromSaved(wf.edgesJson as any[], nodeTypeById));
    setSaveState('idle');
  }, [workflowId]);

  useEffect(() => {
    loadWorkflow();
  }, [loadWorkflow]);

  // Real-time execution overlay via Socket.IO
  useEffect(() => {
    if (!accessToken) return;
    const socket = io(import.meta.env.VITE_API_URL ?? 'http://localhost:4000', {
      path: '/ws/executions',
      auth: { token: accessToken },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    function setNodeStatus(nodeId: string, status: NodeStatus, extra?: Record<string, unknown>) {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status, ...extra } } : n))
      );
    }

    // Highlights edges flowing out of the active/just-completed node so the
    // canvas reads like n8n's live execution trace.
    function setEdgesActive(nodeId: string, active: boolean) {
      setEdges((eds) =>
        eds.map((edge) =>
          edge.source === nodeId
            ? { ...edge, animated: active, style: active ? { stroke: 'rgb(var(--color-signal))', strokeWidth: 2.5 } : undefined }
            : edge
        )
      );
    }

    socket.on('execution:started', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setRunBanner('Execution running…');
      setActiveExecutionId(e.executionId ?? null);
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: {
            ...n.data,
            status: 'idle',
            lastRunInput: undefined,
            lastRunOutput: undefined,
            lastRunError: undefined,
            lastRunDurationMs: undefined,
            lastRunItemCount: undefined,
            lastRunBinary: undefined,
            lastRunExpressionErrors: undefined,
          },
        }))
      );
      setEdges((eds) => eds.map((edge) => ({ ...edge, animated: false, style: undefined })));
    });
    socket.on('node:started', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setNodeStatus(e.nodeId, 'running', { lastRunInput: e.input, lastRunItemCount: e.itemCount, lastRunBinary: e.binary });
      setEdgesActive(e.nodeId, true);
    });
    socket.on('node:completed', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setNodeStatus(e.nodeId, 'success', {
        lastRunOutput: e.output,
        lastRunDurationMs: e.durationMs,
        lastRunItemCount: e.itemCount,
        lastRunError: undefined,
        lastRunBinary: e.binary,
        lastRunExpressionErrors: e.expressionErrors,
      });
      setEdgesActive(e.nodeId, false);
    });
    socket.on('node:failed', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setNodeStatus(e.nodeId, 'failed', { lastRunError: e.error, lastRunDurationMs: e.durationMs });
      setEdgesActive(e.nodeId, false);
    });
    socket.on('node:skipped', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setNodeStatus(e.nodeId, 'skipped');
      setEdgesActive(e.nodeId, false);
    });
    socket.on('execution:completed', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setRunBanner('Execution finished — see history for details.');
      setActiveExecutionId(null);
      setCancelling(false);
      setEdges((eds) => eds.map((edge) => ({ ...edge, animated: false, style: undefined })));
      setTimeout(() => setRunBanner(null), 4000);
      if (e.status === 'failed') {
        pushCanvasToast('Execution failed', 'error');
      } else {
        pushCanvasToast('Execution finished', 'success');
      }
    });
    socket.on('execution:cancelled', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setRunBanner('Execution cancelled.');
      setActiveExecutionId(null);
      setCancelling(false);
      setEdges((eds) => eds.map((edge) => ({ ...edge, animated: false, style: undefined })));
      setTimeout(() => setRunBanner(null), 4000);
      pushCanvasToast('Execution cancelled', 'info');
    });
    // Previously dropped silently (no case existed for these two statuses
    // in the relay's old switch) — the canvas looked frozen on any
    // workflow that paused or that hit a "Respond to Webhook" node.
    socket.on('execution:paused', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setRunBanner('Execution paused — waiting…');
      if (e.nodeId) setNodeStatus(e.nodeId, 'paused' as NodeStatus);
    });
    socket.on('node:webhook-response', (e: any) => {
      if (e.workflowId !== workflowId) return;
      if (e.nodeId) setNodeStatus(e.nodeId, 'success' as NodeStatus, { lastRunOutput: e.output });
      pushCanvasToast('Respond to Webhook node fired', 'info');
    });

    // Presence: viewer avatars + live cursor dots, scoped to this workflow's
    // room (see initRealtime in the API — a separate room from the
    // owner-only execution-status one, open to any collaborator).
    if (workflowId) socket.emit('presence:join', { workflowId });

    socket.on('presence:viewers', (e: { workflowId: string; viewers: { userId: string; email: string; color: string }[] }) => {
      if (e.workflowId !== workflowId) return;
      setPresenceViewers(e.viewers.filter((v) => v.userId !== user?.id));
    });

    socket.on('presence:cursor', (e: { workflowId: string; userId: string; x: number; y: number }) => {
      if (e.workflowId !== workflowId || e.userId === user?.id) return;
      setPresenceViewers((current) => {
        const viewer = current.find((v) => v.userId === e.userId);
        setRemoteCursors((prev) => ({
          ...prev,
          [e.userId]: { x: e.x, y: e.y, color: viewer?.color ?? '#f97316', email: viewer?.email ?? '' },
        }));
        return current;
      });
    });

    return () => {
      if (workflowId) socket.emit('presence:leave', { workflowId });
      socket.disconnect();
    };
  }, [accessToken, workflowId, user?.id]);

  // Throttled cursor broadcast: mouse position within the canvas pane,
  // expressed as a 0-1 fraction of its width/height so it's comparable
  // across viewers with different window sizes/zoom without needing the
  // full ReactFlow screen->flow coordinate transform on either end.
  const lastCursorSentRef = useRef(0);
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const wrapper = canvasWrapperRef.current;
      const socket = socketRef.current;
      if (!wrapper || !socket || !workflowId) return;
      const now = Date.now();
      if (now - lastCursorSentRef.current < 60) return;
      lastCursorSentRef.current = now;
      const rect = wrapper.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      socket.emit('presence:cursor', { workflowId, x, y });
    },
    [workflowId]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds) as Node<FlowNodeData>[]),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );
  /**
   * Resolves the declared connection type for one side of a would-be edge —
   * looks up the node's `nodeType` port declarations (connectionTypes.ts) and
   * finds the specific handle id, falling back to `main` for legacy nodes/
   * handles that predate the typed-port system.
   */
  const resolvePortType = useCallback(
    (nodeId: string | null | undefined, handleId: string | null | undefined, side: 'source' | 'target') => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return NodeConnectionTypes.Main;
      const ports = getNodePorts((node.data as FlowNodeData).nodeType);
      const list = side === 'source' ? ports.outputs : ports.inputs;
      const port = handleId ? list.find((p) => p.id === handleId) : list[0];
      return port?.type ?? NodeConnectionTypes.Main;
    },
    [nodes]
  );

  /**
   * Enforces n8n's connection-type contract: a source output can only wire
   * into a target input of the SAME connection type (an `ai_tool` output
   * can't plug into an `ai_memory` input, etc.), and non-main handles with a
   * `maxConnections` cap (e.g. an Agent's single Model slot) reject further
   * drags once full.
   */
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const c = connection as Connection;
      if (c.source === c.target) return false;
      const sourceType = resolvePortType(c.source, c.sourceHandle, 'source');
      const targetType = resolvePortType(c.target, c.targetHandle, 'target');
      if (sourceType !== targetType) return false;

      const targetNode = nodes.find((n) => n.id === c.target);
      if (targetNode) {
        const ports = getNodePorts((targetNode.data as FlowNodeData).nodeType);
        const targetPort = ports.inputs.find((p) => p.id === c.targetHandle) ?? ports.inputs[0];
        if (targetPort?.maxConnections) {
          const handleKey = c.targetHandle ?? ports.inputs[0]?.id;
          const existing = edges.filter((e) => e.target === c.target && (e.targetHandle ?? ports.inputs[0]?.id) === handleKey).length;
          if (existing >= targetPort.maxConnections) return false;
        }
      }
      return true;
    },
    [nodes, edges, resolvePortType]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const id = `e_${Date.now()}`;
      const connectionType = resolvePortType(connection.source, connection.sourceHandle, 'source');
      const isMain = connectionType === NodeConnectionTypes.Main;
      const meta = CONNECTION_TYPE_META[connectionType];
      // Non-main (AI) wires get the connection type's color + a dashed
      // stroke so a Model/Memory/Tool wire reads visually distinct from the
      // main execution pipe, mirroring n8n's canvas.
      const edgeStyle = isMain ? undefined : { stroke: meta.color, strokeDasharray: '4 3', strokeWidth: 1.5 };
      // Micro-interaction: briefly tag the just-drawn edge so it gets a
      // glow/thickness pulse (see .edge-connect-pulse in index.css), then
      // strip the class once the animation has played so it doesn't replay
      // on every unrelated re-render.
      setEdges((eds) =>
        addEdge({ ...connection, id, className: 'edge-connect-pulse', style: edgeStyle, data: { connectionType } }, eds)
      );
      setTimeout(() => {
        setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, className: undefined } : e)));
      }, 600);
    },
    [resolvePortType]
  );

  /** n8n auto-suffixes a duplicate default label at creation time rather than allowing a silent collision — matters now that `$node["Label"]` expressions resolve by this label. */
  function uniqueLabel(label: string, excludeNodeId?: string): string {
    const existing = new Set(
      nodes.filter((n) => n.id !== excludeNodeId).map((n) => String((n.data as FlowNodeData).label ?? ''))
    );
    if (!existing.has(label)) return label;
    let n = 2;
    while (existing.has(`${label} ${n}`)) n++;
    return `${label} ${n}`;
  }

  function addNode(nodeType: string, label: string) {
    const id = nextId();
    const uniqueLabelValue = uniqueLabel(label);
    const pending = pendingHandleRequest;

    // Wiring from a handle's "+": drop the new node offset from the node the
    // request came from, then connect it to the exact handle that was
    // clicked (only if the new node type actually offers a compatible port
    // for that connection type — otherwise it's just added bare, same as
    // a normal palette pick).
    let position = { x: 120 + nodes.length * 40, y: 120 + nodes.length * 30 };
    if (pending) {
      const originNode = nodes.find((n) => n.id === pending.nodeId);
      if (originNode) {
        position =
          pending.handleType === 'source'
            ? { x: originNode.position.x + 280, y: originNode.position.y }
            : { x: originNode.position.x, y: originNode.position.y + 160 };
      }
    }

    setNodes((nds) => [
      ...nds,
      {
        id,
        type: 'flowNode',
        position,
        data: { label: uniqueLabelValue, nodeType, status: 'idle', params: {}, credentialId: null },
      },
    ]);

    if (pending) {
      const newPorts = getNodePorts(nodeType);
      // The new node's matching port is on the OPPOSITE side of the pending
      // request: clicking a "+" on an output looks for an input of the same
      // type on the new node (and vice versa).
      const matchList = pending.handleType === 'source' ? newPorts.inputs : newPorts.outputs;
      const matchPort = matchList.find((p) => p.type === pending.port.type);
      if (matchPort) {
        const connection: Connection =
          pending.handleType === 'source'
            ? { source: pending.nodeId, sourceHandle: pending.port.id, target: id, targetHandle: matchPort.id }
            : { source: id, sourceHandle: matchPort.id, target: pending.nodeId, targetHandle: pending.port.id };
        // Defer one tick so the node exists in `nodes` before onConnect's
        // resolvePortType looks it up.
        setTimeout(() => onConnect(connection), 0);
      }
      setPendingHandleRequest(null);
    }
  }

  /** Adds a freeform sticky note (UI-only annotation, not a real workflow
   *  node). Saved/loaded with its real `stickyNote` type (see handleSave),
   *  and stripped out of the execution graph entirely by the worker's
   *  executor (NON_EXECUTABLE_NODE_TYPES) — it never reaches a node plugin. */
  function addStickyNote() {
    const id = nextId();
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: 'stickyNote',
        position: { x: 160 + nds.length * 30, y: 160 + nds.length * 20 },
        style: { width: 200, height: 140 },
        data: { label: 'Note', text: '' } as any,
      },
    ]);
  }

  /** Wraps the currently selected nodes in a new group container: creates a
   *  `group` node sized to their bounding box and re-parents them (setting
   *  `parentId`/`extent: 'parent'`), which is @xyflow/react's native
   *  node-grouping model. */
  function groupSelectedNodes() {
    const selected = nodes.filter((n) => n.selected);
    if (selected.length < 2) return;
    const minX = Math.min(...selected.map((n) => n.position.x)) - 30;
    const minY = Math.min(...selected.map((n) => n.position.y)) - 50;
    const maxX = Math.max(...selected.map((n) => n.position.x + (typeof n.width === 'number' ? n.width : 180))) + 30;
    const maxY = Math.max(...selected.map((n) => n.position.y + (typeof n.height === 'number' ? n.height : 80))) + 30;
    const groupId = nextId();
    const selectedIds = new Set(selected.map((n) => n.id));

    setNodes((nds) => [
      {
        id: groupId,
        type: 'group',
        position: { x: minX, y: minY },
        style: { width: maxX - minX, height: maxY - minY },
        data: { label: 'Group' } as any,
      },
      ...nds.map((n) =>
        selectedIds.has(n.id)
          ? { ...n, parentId: groupId, extent: 'parent' as const, position: { x: n.position.x - minX, y: n.position.y - minY }, selected: false }
          : n
      ),
    ]);
  }

  /** Re-arranges every node into left-to-right layers by graph depth. */
  function applyAutoLayout() {
    setNodes((nds) => autoLayout(nds, edges));
  }

  /** Called by ExecutionScrubber whenever the user steps to a different
   *  past execution — stashes that run's per-node results so displayNodes
   *  can paint them onto the canvas without touching the live `nodes`
   *  state (so nothing is lost when the user exits replay). */
  function handleReplay(execution: ExecutionSummary, nodeRuns: HistoryNodeRun[]) {
    setReplayExecution(execution);
    const byNode: Record<string, HistoryNodeRun> = {};
    for (const run of nodeRuns) byNode[run.nodeId] = run;
    setReplayNodeRuns(byNode);
  }

  function exitReplay() {
    setHistoryOpen(false);
    setReplayExecution(null);
    setReplayNodeRuns(null);
  }

  /** Canvas nodes actually handed to <ReactFlow>: identical to `nodes`
   *  outside of replay, or overlaid with a past execution's per-node
   *  status/timing/input/output while the scrubber is active. Nodes that
   *  didn't run in that execution (e.g. added since, or on a skipped
   *  branch) fall back to 'idle' rather than showing stale live data. */
  const displayNodes = useMemo(() => {
    if (!replayNodeRuns) return nodes;
    return nodes.map((n) => {
      const run = replayNodeRuns[n.id];
      if (!run) {
        return { ...n, data: { ...n.data, status: 'idle' as NodeStatus, lastRunOutput: undefined, lastRunError: undefined } };
      }
      const durationMs =
        run.startedAt && run.finishedAt
          ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
          : undefined;
      const status: NodeStatus =
        run.status === 'success' || run.status === 'failed' || run.status === 'skipped' || run.status === 'running'
          ? (run.status as NodeStatus)
          : 'idle';
      return {
        ...n,
        data: {
          ...n.data,
          status,
          lastRunInput: run.input,
          lastRunOutput: run.output,
          lastRunError: run.error ?? undefined,
          lastRunDurationMs: durationMs,
        },
      };
    });
  }, [nodes, replayNodeRuns]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  function updateSelectedNode(updates: Partial<FlowNodeData>) {
    if (!selectedNodeId) return;
    setNodes((nds) =>
      nds.map((n) => (n.id === selectedNodeId ? { ...n, data: { ...n.data, ...updates } } : n))
    );
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return;
    const removed = nodes.find((n) => n.id === selectedNodeId);
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
    if (removed) toast.info(`Deleted "${(removed.data as FlowNodeData).label ?? removed.id}"`);
  }

  // Undo/redo history — snapshots nodes+edges on every change (skipped
  // while an undo/redo itself is applying a snapshot, to avoid loops).
  useEffect(() => {
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      return;
    }
    historyRef.current.past.push({ nodes, edges });
    if (historyRef.current.past.length > 50) historyRef.current.past.shift();
    historyRef.current.future = [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  function undo() {
    const { past, future } = historyRef.current;
    if (past.length < 2) return; // need at least [previous, current]
    const current = past.pop()!;
    future.push(current);
    const previous = past[past.length - 1];
    skipHistoryRef.current = true;
    setNodes(previous.nodes);
    setEdges(previous.edges);
  }

  function redo() {
    const { future } = historyRef.current;
    const next = future.pop();
    if (!next) return;
    historyRef.current.past.push(next);
    skipHistoryRef.current = true;
    setNodes(next.nodes);
    setEdges(next.edges);
  }

  function duplicateSelectedNode() {
    if (!selectedNodeId) return;
    const original = nodes.find((n) => n.id === selectedNodeId);
    if (!original) return;
    const id = nextId();
    const originalLabel = String((original.data as FlowNodeData).label ?? original.id);
    const newLabel = uniqueLabel(originalLabel);
    setNodes((nds) => [
      ...nds,
      {
        ...original,
        id,
        position: { x: original.position.x + 40, y: original.position.y + 40 },
        selected: false,
        data: { ...original.data, label: newLabel },
      },
    ]);
    toast.info(`Duplicated "${originalLabel}"`);
  }

  // Keyboard shortcuts: Ctrl/Cmd+S save, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z
  // (or Ctrl+Y) redo, Ctrl/Cmd+D duplicate selected node, Delete/Backspace
  // removes the selected node when focus isn't in an input/textarea.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTyping = ['INPUT', 'TEXTAREA'].includes(target.tagName);
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((mod && e.key.toLowerCase() === 'z' && e.shiftKey) || (mod && e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'd' && selectedNodeId) {
        e.preventDefault();
        duplicateSelectedNode();
      } else if (!isTyping && (e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        e.preventDefault();
        deleteSelectedNode();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, nodes, edges, name]);

  async function handleSave() {
    setSaveState('saving');
    const nodesPayload = nodes.map((n) => {
      // Sticky notes and group containers are canvas-only annotations
      // (see StickyNoteNode.tsx / GroupNode.tsx) — the worker's executor
      // strips these types out of the execution graph entirely, so it's
      // safe (and necessary, so they survive a reload) to save them with
      // their real React Flow type, size, and any parent/group nesting.
      if (n.type === 'stickyNote' || n.type === 'group') {
        return {
          id: n.id,
          type: n.type,
          label: n.data.label as string,
          position: n.position,
          params: n.type === 'stickyNote' ? { text: n.data.text, color: n.data.color } : {},
          style:
            typeof n.style?.width === 'number' && typeof n.style?.height === 'number'
              ? { width: n.style.width, height: n.style.height }
              : null,
          parentId: n.parentId ?? null,
          extent: n.extent === 'parent' ? ('parent' as const) : null,
        };
      }
      return {
        id: n.id,
        type: n.data.nodeType,
        label: n.data.label,
        position: n.position,
        params: n.data.params,
        credentialId: n.data.credentialId,
        retry: (n.data.retry as { maxAttempts: number; delayMs: number } | null) ?? null,
        continueOnFail: Boolean(n.data.continueOnFail),
        isPinned: Boolean(n.data.isPinned),
        pinnedOutput: n.data.pinnedOutput,
        notes: (n.data.notes as string | null | undefined) ?? null,
        parentId: n.parentId ?? null,
        extent: n.extent === 'parent' ? ('parent' as const) : null,
      };
    });
    const edgesPayload = serializeEdgesForSave(edges);
    try {
      await api.put(`/workflows/${workflowId}`, { name, nodes: nodesPayload, edges: edgesPayload });
      await api.post(`/workflows/${workflowId}/versions`, { nodesJson: nodesPayload, edgesJson: edgesPayload });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch (err: any) {
      setSaveState('idle');
      toast.error(err?.response?.data?.error ?? 'Failed to save workflow');
      throw err;
    }
  }

  async function handleToggleActive() {
    const { data } = await api.post(`/workflows/${workflowId}/activate`, { isActive: !isActive });
    setIsActive(data.workflow.isActive);
  }

  // A workflow with an invalid Schedule cron can still be saved as a draft, but shouldn't be activated
  // (it would otherwise fail confusingly when the scheduler tries to register the repeatable job).
  const hasInvalidCron = nodes.some(
    (n) => n.data.nodeType === 'schedule' && !isScheduleCronValid('schedule', (n.data.params as Record<string, unknown>) ?? {})
  );

  async function handleGenerateWithAI() {
    if (!aiPrompt.trim()) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const openaiCred = credentials.find((c) => c.type === 'openai');
      const { data } = await api.post('/ai/generate-workflow', {
        prompt: aiPrompt,
        credentialId: openaiCred?.id,
      });
      const wf = data.workflow as {
        name?: string;
        nodes: Array<{ id: string; type: string; position?: { x: number; y: number }; params?: Record<string, unknown> }>;
        edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null }>;
      };
      if (wf.name) setName(wf.name);
      setNodes(
        wf.nodes.map((n, i) => ({
          id: n.id,
          type: 'flowNode',
          position: n.position ?? { x: 120 + i * 260, y: 200 },
          data: {
            label: n.type,
            nodeType: n.type,
            status: 'idle' as NodeStatus,
            params: n.params ?? {},
            credentialId: null,
          },
        }))
      );
      setEdges(
        wf.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
        }))
      );
      setAiModalOpen(false);
      setAiPrompt('');
    } catch (err: any) {
      setAiError(err?.response?.data?.error ?? 'Generation failed. Check the API server logs.');
    } finally {
      setAiBusy(false);
    }
  }

  async function handleRun() {
    try {
      await handleSave();
    } catch {
      return; // handleSave already surfaced a toast
    }
    try {
      const res = await api.post(`/workflows/${workflowId}/execute`, {});
      setActiveExecutionId(res.data?.executionId ?? null);
      setRunBanner('Execution enqueued…');
      pushCanvasToast('Run started', 'info');
    } catch (err: any) {
      pushCanvasToast(err?.response?.data?.error ?? 'Failed to start run', 'error');
    }
  }

  async function handleCancel() {
    if (!activeExecutionId || cancelling) return;
    setCancelling(true);
    try {
      await api.post(`/executions/${activeExecutionId}/cancel`, {});
      // Don't clear activeExecutionId/cancelling here — the worker still
      // needs to unwind in-flight nodes, so wait for the execution:cancelled
      // socket event (which also flips the banner/edges) to confirm it landed.
    } catch (err: any) {
      setCancelling(false);
      pushCanvasToast(err?.response?.data?.error ?? 'Failed to cancel execution', 'error');
    }
  }

  /** "Retry this node" — reachable straight from a failed node's hover popover
   *  (NodeInspectPopover), not just NodeConfigPanel. Re-runs the workflow
   *  starting at nodeId, reusing every other node's cached output from the
   *  active run if one is in flight, otherwise the most recent past execution. */
  async function handleRetryNode(nodeId: string) {
    if (!workflowId) return;
    try {
      let sourceExecutionId = activeExecutionId ?? undefined;
      if (!sourceExecutionId) {
        const { data } = await api.get(`/workflows/${workflowId}/executions`);
        sourceExecutionId = data.executions?.[0]?.id;
      }
      if (!sourceExecutionId) {
        pushCanvasToast('No past execution to retry from yet — run the whole workflow once first.', 'error');
        return;
      }
      await api.post(`/executions/${sourceExecutionId}/retry-from/${nodeId}`);
      const node = nodes.find((n) => n.id === nodeId);
      pushCanvasToast(`Retrying from "${node?.data.label ?? 'node'}"…`, 'success');
    } catch (err: any) {
      pushCanvasToast(err?.response?.data?.error ?? 'Failed to retry from this node', 'error');
    }
  }

  async function doDiscard() {
    if (!workflowId) return;
    await loadWorkflow();
    setDiscardOpen(false);
  }

  async function doDelete() {
    if (!workflowId) return;
    await api.delete(`/workflows/${workflowId}`);
    setDeleteOpen(false);
    toast.info(`Deleted workflow "${name}"`);
    navigate('/workflows');
  }

  return (
    <div className="h-screen flex flex-col">
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={
          [
            { id: 'save', label: 'Save workflow', hint: '⌘S', group: 'Workflow', run: handleSave },
            { id: 'run', label: 'Run workflow', hint: '', group: 'Workflow', run: handleRun },
            { id: 'toggle-active', label: isActive ? 'Deactivate workflow' : 'Activate workflow', group: 'Workflow', run: handleToggleActive },
            { id: 'add-note', label: 'Add sticky note', group: 'Canvas', run: addStickyNote },
            { id: 'group', label: 'Group selected nodes', group: 'Canvas', run: groupSelectedNodes },
            { id: 'auto-layout', label: 'Auto-layout nodes', group: 'Canvas', run: applyAutoLayout },
            { id: 'toggle-collab', label: 'Toggle versions & comments panel', group: 'Canvas', run: () => setCollabOpen((v) => !v) },
            { id: 'ai', label: 'Generate with AI', group: 'Canvas', run: () => setAiModalOpen(true) },
            ...NODE_TYPES.map((n) => ({
              id: `add-node-${n.type}`,
              label: `Add node: ${n.label}`,
              hint: n.category,
              group: 'Add node',
              run: () => addNode(n.type, n.label),
            })),
            ...credentials.map((c) => ({
              id: `credential-${c.id}`,
              label: c.name ?? c.type,
              hint: 'Credential',
              group: 'Credentials',
              run: () => navigate('/credentials'),
            })),
            { id: 'templates', label: 'Browse template gallery', group: 'Navigate', run: () => navigate('/templates') },
            { id: 'history', label: 'View execution history', group: 'Navigate', run: () => navigate(`/workflows/${workflowId}/executions`) },
            { id: 'tests', label: 'View workflow tests', group: 'Navigate', run: () => navigate(`/workflows/${workflowId}/tests`) },
            { id: 'workflows', label: 'Back to workflows', group: 'Navigate', run: () => navigate('/workflows') },
            { id: 'credentials', label: 'Go to credentials', group: 'Navigate', run: () => navigate('/credentials') },
            { id: 'workspaces', label: 'Go to workspaces', group: 'Navigate', run: () => navigate('/workspaces') },
            { id: 'marketplace', label: 'Go to marketplace', group: 'Navigate', run: () => navigate('/marketplace') },
          ] as CommandItem[]
        }
      />
      <header className="min-h-[56px] border-b border-panelBorder bg-panel flex flex-wrap items-center gap-y-2 px-4 py-2 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/workflows" className="focus-ring text-muted hover:text-ink text-sm">
            ← Workflows
          </Link>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="focus-ring bg-transparent text-sm font-medium border-b border-transparent hover:border-panelBorder focus:border-signal px-1 max-w-[min(50vw,520px)] truncate"
          />
          {isActive && (
            <span className="text-xs px-2 py-0.5 rounded-full border text-signal border-signal/40 bg-signal/10">
              Active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end ml-auto w-full sm:w-auto">
          {runBanner && <span className="text-xs text-amber mr-2">{runBanner}</span>}
          {replayExecution && (
            <span className="text-xs text-signal mr-2">
              Viewing replay · {replayExecution.triggerType} · {replayExecution.status}
            </span>
          )}
          <button
            onClick={addStickyNote}
            title="Add sticky note"
            className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder hover:border-signal/50 transition"
          >
            📝 Note
          </button>
          <button
            onClick={groupSelectedNodes}
            title="Group selected nodes"
            className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder hover:border-signal/50 transition"
          >
            ⬚ Group
          </button>
          <button
            onClick={applyAutoLayout}
            title="Auto-layout"
            className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder hover:border-signal/50 transition"
          >
            ⇥ Auto-layout
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            title="Command palette (Cmd+K)"
            className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder hover:border-signal/50 transition"
          >
            ⌘K
          </button>
          <Link
            to="/templates"
            className="focus-ring text-sm text-muted hover:text-ink px-3 py-1.5"
          >
            Templates
          </Link>
          <button
            onClick={() => setAiModalOpen(true)}
            className="focus-ring text-sm px-3 py-1.5 rounded-md border border-signal/40 text-signal hover:bg-signal/10 transition"
          >
            ✨ Generate with AI
          </button>
          <Link
            to={`/workflows/${workflowId}/executions`}
            className="focus-ring text-sm text-muted hover:text-ink px-3 py-1.5"
          >
            History
          </Link>
          <button
            onClick={() => (historyOpen ? exitReplay() : setHistoryOpen(true))}
            className={`focus-ring text-sm px-3 py-1.5 rounded-md border transition ${
              historyOpen ? 'border-signal/40 text-signal bg-signal/10' : 'border-panelBorder text-muted hover:text-ink hover:border-signal/50'
            }`}
            title="Step through past executions on the canvas"
          >
            Replay
          </button>
          <Link
            to={`/workflows/${workflowId}/tests`}
            className="focus-ring text-sm text-muted hover:text-ink px-3 py-1.5"
          >
            Tests
          </Link>
          <label className="sr-only" htmlFor="node-density">Node card density</label>
          <select
            id="node-density"
            title="Node card density"
            value={density}
            onChange={(e) => changeDensity(e.target.value as NodeDensity)}
            className="focus-ring text-sm px-2 py-1.5 rounded-md border border-panelBorder bg-canvas text-ink mr-1"
          >
            {NODE_DENSITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {presenceViewers.length > 0 && (
            <div className="flex items-center -space-x-2 mr-1" title={presenceViewers.map((v) => v.email).join(', ')}>
              {presenceViewers.slice(0, 5).map((v) => (
                <div
                  key={v.userId}
                  className="w-6 h-6 rounded-full border-2 border-panel flex items-center justify-center text-[10px] font-medium text-canvas"
                  style={{ backgroundColor: v.color }}
                >
                  {v.email.slice(0, 1).toUpperCase()}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => setCollabOpen((v) => !v)}
            className={`focus-ring text-sm px-3 py-1.5 rounded-md border transition ${
              collabOpen ? 'border-signal/40 text-signal bg-signal/10' : 'border-panelBorder hover:border-signal/50'
            }`}
          >
            Versions, Comments & Settings
          </button>
          <button
            onClick={() => setShareModalOpen(true)}
            className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder hover:border-signal/50 transition"
          >
            Share
          </button>
          <button
            onClick={() => setDiscardOpen(true)}
            className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder hover:border-amber-400/50 transition"
            title="Discard unsaved changes and reload last saved version"
          >
            Discard
          </button>
          <button
            onClick={handleToggleActive}
            disabled={!isActive && hasInvalidCron}
            title={!isActive && hasInvalidCron ? 'Fix the invalid cron expression on the Schedule node before activating' : undefined}
            className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder hover:border-signal/50 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isActive ? 'Deactivate' : 'Activate'}
          </button>
          <button
            onClick={handleSave}
            className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder hover:border-signal/50 transition"
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save'}
          </button>
          <button
            onClick={handleRun}
            className="focus-ring text-sm px-3 py-1.5 rounded-md bg-signal text-canvas font-medium hover:brightness-110 transition"
          >
            Run
          </button>
          {activeExecutionId && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              title="Cancel this run"
              className="focus-ring text-sm px-3 py-1.5 rounded-md border border-alert/40 text-alert hover:bg-alert/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {cancelling ? 'Cancelling…' : 'Cancel run'}
            </button>
          )}
          <button
            onClick={() => setDeleteOpen(true)}
            className="focus-ring text-sm px-3 py-1.5 rounded-md border border-alert/40 text-alert hover:bg-alert/10 transition"
            title="Delete this workflow"
          >
            Delete
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <div className="flex flex-col min-h-0 h-full">
          {pendingHandleRequest && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs border-b border-panelBorder bg-panel">
              <span style={{ color: CONNECTION_TYPE_META[pendingHandleRequest.port.type].color }}>●</span>
              <span className="text-muted">
                Pick a node to plug into{' '}
                <strong className="text-ink">
                  {pendingHandleRequest.port.label || CONNECTION_TYPE_META[pendingHandleRequest.port.type].label || 'this'}
                </strong>
              </span>
              <button
                className="focus-ring ml-auto text-muted hover:text-ink"
                onClick={() => setPendingHandleRequest(null)}
                title="Cancel"
              >
                ✕
              </button>
            </div>
          )}
          <NodePalette onAdd={addNode} compatibleTypes={compatiblePaletteTypes} />
        </div>
        <div className="flex-1 min-w-0 relative" ref={canvasWrapperRef} onMouseMove={handleCanvasMouseMove}>
          {canvasToasts.length > 0 && (
            <div className="pointer-events-none absolute top-3 right-3 z-40 flex flex-col gap-2 w-72">
              {canvasToasts.map((t) => (
                <div
                  key={t.id}
                  role="status"
                  className={`pointer-events-auto flex items-center gap-2 rounded-md border px-3 py-2 text-xs shadow-lg backdrop-blur-sm ${
                    t.variant === 'error'
                      ? 'border-alert/40 bg-alert/10 text-alert'
                      : t.variant === 'success'
                        ? 'border-signal/40 bg-signal/10 text-signal'
                        : 'border-panelBorder bg-panel text-ink'
                  }`}
                >
                  <span className="text-[13px] leading-none">
                    {t.variant === 'error' ? '✕' : t.variant === 'success' ? '✓' : 'ℹ'}
                  </span>
                  <span className="flex-1 truncate">{t.message}</span>
                  <button
                    onClick={() => setCanvasToasts((cur) => cur.filter((c) => c.id !== t.id))}
                    className="focus-ring ml-1 text-inherit opacity-60 hover:opacity-100 leading-none"
                    aria-label="Dismiss notification"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {historyOpen && workflowId && (
            <ExecutionScrubber workflowId={workflowId} onReplay={handleReplay} onExit={exitReplay} />
          )}
          <NodeDensityContext.Provider value={density}>
          <CredentialNamesContext.Provider value={credentialNames}>
          <CanvasHandleAddContext.Provider value={setPendingHandleRequest}>
          <NodeRetryContext.Provider value={handleRetryNode}>
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            colorMode="dark"
            fitView
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
          </NodeRetryContext.Provider>
          </CanvasHandleAddContext.Provider>
          </CredentialNamesContext.Provider>
          </NodeDensityContext.Provider>
          {Object.entries(remoteCursors).map(([uid, c]) => (
            <div
              key={uid}
              className="pointer-events-none absolute z-20 transition-[left,top] duration-75"
              style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" style={{ fill: c.color }}>
                <path d="M0 0 L16 6 L7 8 L5 16 Z" />
              </svg>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded text-canvas whitespace-nowrap ml-2 -mt-1 inline-block"
                style={{ backgroundColor: c.color }}
              >
                {c.email}
              </span>
            </div>
          ))}
        </div>
        {selectedNode && (
          <NodeConfigPanel
            nodeId={selectedNode.id}
            nodeType={selectedNode.data.nodeType ?? ''}
            label={selectedNode.data.label}
            params={selectedNode.data.params as Record<string, unknown>}
            credentialId={(selectedNode.data.credentialId as string) ?? null}
            credentials={credentials}
            onCredentialsRefresh={refreshCredentials}
            retry={(selectedNode.data.retry as { maxAttempts: number; delayMs: number } | null) ?? null}
            continueOnFail={Boolean(selectedNode.data.continueOnFail)}
            isPinned={Boolean(selectedNode.data.isPinned)}
            pinnedOutput={selectedNode.data.pinnedOutput}
            notes={(selectedNode.data.notes as string | null) ?? null}
            otherNodeLabels={nodes.filter((n) => n.id !== selectedNode.id).map((n) => n.data.label)}
            workflowId={workflowId}
            replayExecutionId={replayExecution?.id}
            siblingWebhookPaths={nodes
              .filter((n) => n.id !== selectedNode.id && n.data.nodeType === 'webhook')
              .map((n) => String((n.data.params as Record<string, unknown> | undefined)?.path ?? ''))
              .filter(Boolean)}
            siblingChatPaths={nodes
              .filter((n) => n.id !== selectedNode.id && n.data.nodeType === 'chatTrigger')
              .map((n) => String((n.data.params as Record<string, unknown> | undefined)?.path ?? 'default'))
              .filter(Boolean)}
            hasRespondToWebhookNode={nodes.some((n) => n.data.nodeType === 'respondToWebhook')}
            isWorkflowActive={isActive}
            lastRunOutput={selectedNode.data.lastRunOutput}
            lastRunInput={selectedNode.data.lastRunInput}
            upstreamOutput={(() => {
              const incoming = edges.filter((e) => e.target === selectedNode.id);
              if (incoming.length === 0) return undefined;
              // Mirror apps/worker/src/engine/executor.ts's real merge behavior:
              // concatenate every connected upstream node's last output, not
              // just the first one — so nodes with multiple inputs (merge,
              // join, etc.) preview the same combined shape they'll actually
              // receive at runtime.
              const collected: unknown[] = [];
              for (const e of incoming) {
                const src = nodes.find((n) => n.id === e.source);
                const out = src?.data.lastRunOutput;
                if (out === undefined) continue;
                if (Array.isArray(out)) collected.push(...out);
                else collected.push(out);
              }
              if (collected.length === 0) return undefined;
              return collected.length === 1 ? collected[0] : collected;
            })()}
            onChange={updateSelectedNode}
            onDelete={deleteSelectedNode}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
        {collabOpen && workflowId && (
          <CollabPanel workflowId={workflowId} onClose={() => setCollabOpen(false)} />
        )}
        {shareModalOpen && workflowId && (
          <WorkflowShareModal workflowId={workflowId} workflowName={name} onClose={() => setShareModalOpen(false)} />
        )}
      </div>

      {aiModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="w-[520px] bg-panel border border-panelBorder rounded-lg p-5 space-y-3">
            <h2 className="text-sm font-display uppercase tracking-widest text-muted">
              ✨ AI Agent — Build a workflow
            </h2>
            <p className="text-xs text-muted">
              Describe what you want automated in plain English. This calls your OpenAI credential
              (or the server's OPENAI_API_KEY) and replaces the current canvas with a generated
              workflow you can then edit and attach real credentials to.
            </p>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={4}
              placeholder='e.g. "When a webhook receives an order, check if total > 100, then post a Slack message and log it to Google Sheets"'
              className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm text-ink resize-none"
            />
            {aiError && <p className="text-xs text-red-400">{aiError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setAiModalOpen(false)}
                className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder text-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateWithAI}
                disabled={aiBusy}
                className="focus-ring text-sm px-3 py-1.5 rounded-md bg-signal text-canvas font-medium hover:brightness-110 disabled:opacity-50"
              >
                {aiBusy ? 'Generating…' : 'Generate workflow'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm: Discard Changes */}
      <ConfirmDialog
        open={discardOpen}
        title="Discard unsaved changes?"
        description="This will reload the last saved version from the server and lose your current edits."
        confirmLabel="Discard"
        cancelLabel="Cancel"
        variant="neutral"
        onConfirm={doDiscard}
        onClose={() => setDiscardOpen(false)}
      />

      {/* Confirm: Delete Workflow */}
      <ConfirmDialog
        open={deleteOpen}
        title="Delete this workflow?"
        description="This action cannot be undone. All versions and history will be removed."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={doDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}

interface WorkflowShareEntry {
  id: string;
  sharedWithUserId: string;
  sharedWithEmail: string;
  role: 'viewer' | 'editor' | 'admin';
}

/** Direct, per-user workflow sharing (independent of workspace roles) plus
 *  ownership transfer — mirrors the credential ShareModal in
 *  CredentialsPage.tsx, adapted to the viewer/editor/admin role rank. */
function WorkflowShareModal({
  workflowId,
  workflowName,
  onClose,
}: {
  workflowId: string;
  workflowName: string;
  onClose: () => void;
}) {
  const [shares, setShares] = useState<WorkflowShareEntry[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor' | 'admin'>('viewer');
  const [error, setError] = useState<string | null>(null);
  const [transferEmail, setTransferEmail] = useState('');
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferDone, setTransferDone] = useState(false);

  async function load() {
    try {
      const { data } = await api.get(`/workflows/${workflowId}/shares`);
      setShares(data.shares);
    } catch {
      // Most likely the caller isn't admin/owner on this workflow — leave the list empty.
      setShares([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  async function handleShare(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/workflows/${workflowId}/shares`, { email, role });
      setEmail('');
      load();
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Could not share this workflow.');
    }
  }

  async function handleUnshare(userId: string) {
    await api.delete(`/workflows/${workflowId}/shares/${userId}`);
    load();
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    setTransferError(null);
    try {
      await api.post(`/workflows/${workflowId}/transfer-ownership`, { email: transferEmail });
      setTransferDone(true);
      load();
    } catch (err: any) {
      setTransferError(err.response?.data?.error ?? 'Could not transfer ownership.');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-panel border border-panelBorder rounded-xl p-6 w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Share "{workflowName}"</h3>
          <button onClick={onClose} className="text-muted hover:text-alert text-sm">
            ✕
          </button>
        </div>
        <p className="text-muted text-xs">
          Share this workflow with a teammate directly, regardless of their role in the workspace. Viewer can
          open and inspect it, Editor can also edit/run/activate, Admin can also share/delete it.
        </p>

        {error && (
          <div className="text-alert text-sm bg-alert/10 border border-alert/30 rounded-md px-3 py-2">{error}</div>
        )}

        <form onSubmit={handleShare} className="flex gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="focus-ring flex-1 bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as any)}
            className="focus-ring bg-canvas border border-panelBorder rounded-md px-2 py-2 text-sm"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            className="focus-ring bg-signal text-canvas text-sm font-medium px-3 py-2 rounded-md hover:brightness-110 transition"
          >
            Share
          </button>
        </form>

        <div className="space-y-2 max-h-48 overflow-y-auto">
          {shares?.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between bg-canvas border border-panelBorder rounded-md px-3 py-2"
            >
              <div>
                <p className="text-sm">{s.sharedWithEmail}</p>
                <p className="text-muted text-xs capitalize">{s.role} access</p>
              </div>
              <button
                onClick={() => handleUnshare(s.sharedWithUserId)}
                className="text-xs text-muted hover:text-alert transition"
              >
                Remove
              </button>
            </div>
          ))}
          {shares?.length === 0 && <p className="text-muted text-xs text-center py-4">Not shared with anyone yet.</p>}
        </div>

        <div className="border-t border-panelBorder pt-4 space-y-2">
          <h4 className="text-sm font-medium">Transfer ownership</h4>
          <p className="text-muted text-xs">
            Makes another user the real owner of this workflow. You'll keep Admin access afterward. Only the
            current owner can do this.
          </p>
          {transferError && (
            <div className="text-alert text-sm bg-alert/10 border border-alert/30 rounded-md px-3 py-2">
              {transferError}
            </div>
          )}
          {transferDone ? (
            <p className="text-xs text-signal">Ownership transferred.</p>
          ) : (
            <form onSubmit={handleTransfer} className="flex gap-2">
              <input
                type="email"
                required
                value={transferEmail}
                onChange={(e) => setTransferEmail(e.target.value)}
                placeholder="new-owner@company.com"
                className="focus-ring flex-1 bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="focus-ring text-sm px-3 py-2 rounded-md border border-alert/40 text-alert hover:bg-alert/10 transition"
              >
                Transfer
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}