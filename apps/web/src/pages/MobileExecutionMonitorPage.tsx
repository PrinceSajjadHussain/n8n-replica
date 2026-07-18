import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import AppShell from '../components/AppShell';

type NodeStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped';

interface MonitorNode {
  id: string;
  label?: string;
  type: string;
  status: NodeStatus;
  durationMs?: number;
  error?: string;
}

interface WorkflowSummary {
  id: string;
  name: string;
  isActive: boolean;
}

const STATUS_STYLES: Record<NodeStatus, string> = {
  idle: 'border-panelBorder text-muted',
  running: 'border-signal text-signal bg-signal/10 animate-pulse',
  success: 'border-signal/40 text-signal bg-signal/5',
  failed: 'border-alert text-alert bg-alert/10',
  skipped: 'border-panelBorder text-muted opacity-60',
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: 'Idle',
  running: 'Running…',
  success: 'Success',
  failed: 'Failed',
  skipped: 'Skipped',
};

/** Phone-sized, view-only counterpart to the full drag-and-drop CanvasPage.
 *  No React Flow, no editing — just a live-updating list of nodes and their
 *  current run status, driven by the same Socket.IO execution events the
 *  desktop canvas listens to. Automatically shown instead of CanvasPage
 *  when the viewport is phone-width (see CanvasPage's useIsMobile check). */
export default function MobileExecutionMonitorPage() {
  const { id: workflowId } = useParams();
  const { accessToken } = useAuthStore();
  const [workflow, setWorkflow] = useState<WorkflowSummary | null>(null);
  const [nodes, setNodes] = useState<MonitorNode[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!workflowId) return;
    api.get(`/workflows/${workflowId}`).then(({ data }) => {
      setWorkflow({ id: data.workflow.id, name: data.workflow.name, isActive: data.workflow.isActive });
      const wfNodes = (data.workflow.nodesJson ?? data.workflow.nodes ?? []).filter(
        (n: any) => n.type !== 'stickyNote' && n.type !== 'group'
      );
      setNodes(wfNodes.map((n: any) => ({ id: n.id, label: n.label, type: n.type, status: 'idle' as NodeStatus })));
    });
  }, [workflowId]);

  useEffect(() => {
    if (!accessToken || !workflowId) return;
    const socket = io(import.meta.env.VITE_API_URL ?? 'http://localhost:4000', {
      path: '/ws/executions',
      auth: { token: accessToken },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    function patch(nodeId: string, fields: Partial<MonitorNode>) {
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, ...fields } : n)));
    }

    socket.on('execution:started', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setBanner('Execution running…');
      setNodes((prev) => prev.map((n) => ({ ...n, status: 'idle', durationMs: undefined, error: undefined })));
    });
    socket.on('node:started', (e: any) => {
      if (e.workflowId !== workflowId) return;
      patch(e.nodeId, { status: 'running' });
    });
    socket.on('node:completed', (e: any) => {
      if (e.workflowId !== workflowId) return;
      patch(e.nodeId, { status: 'success', durationMs: e.durationMs, error: undefined });
    });
    socket.on('node:failed', (e: any) => {
      if (e.workflowId !== workflowId) return;
      patch(e.nodeId, { status: 'failed', error: e.error, durationMs: e.durationMs });
    });
    socket.on('node:skipped', (e: any) => {
      if (e.workflowId !== workflowId) return;
      patch(e.nodeId, { status: 'skipped' });
    });
    socket.on('execution:completed', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setBanner('Execution finished');
      setTimeout(() => setBanner(null), 4000);
    });

    return () => {
      socket.disconnect();
    };
  }, [accessToken, workflowId]);

  return (
    <AppShell>
      <div className="mb-4">
        <p className="text-[11px] uppercase tracking-wider text-muted mb-1">Read-only · mobile monitor</p>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold truncate">{workflow?.name ?? 'Loading…'}</h1>
          {workflow && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${
                workflow.isActive ? 'text-signal border-signal/40 bg-signal/10' : 'text-muted border-panelBorder'
              }`}
            >
              {workflow.isActive ? 'Active' : 'Inactive'}
            </span>
          )}
        </div>
        <p className="text-xs text-muted mt-1">
          Open on a larger screen to edit the canvas.{' '}
          <Link to={`/workflows/${workflowId}/executions`} className="text-signal focus-ring">
            View execution history →
          </Link>
        </p>
      </div>

      {banner && <div className="mb-3 text-xs px-3 py-2 rounded-md bg-signal/10 text-signal border border-signal/30">{banner}</div>}

      <div className="space-y-2">
        {nodes.map((n) => (
          <div key={n.id} className={`rounded-lg border px-3 py-2.5 flex items-center justify-between gap-2 ${STATUS_STYLES[n.status]}`}>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{n.label || n.type}</p>
              <p className="text-[11px] opacity-80">{n.type}</p>
              {n.error && <p className="text-[11px] mt-0.5 truncate">{n.error}</p>}
            </div>
            <div className="text-right shrink-0">
              <p className="text-[11px] font-medium">{STATUS_LABEL[n.status]}</p>
              {n.durationMs !== undefined && <p className="text-[10px] opacity-70">{n.durationMs}ms</p>}
            </div>
          </div>
        ))}
        {nodes.length === 0 && workflow && <p className="text-sm text-muted">This workflow has no executable nodes yet.</p>}
      </div>
    </AppShell>
  );
}
