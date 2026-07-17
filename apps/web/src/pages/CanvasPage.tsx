import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
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
import NodePalette from '../components/NodePalette';
import NodeConfigPanel from '../components/NodeConfigPanel';

const nodeTypes = { flowNode: FlowNode };
let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `node_${Date.now()}_${idCounter}`;
}

export default function CanvasPage() {
  const { id: workflowId } = useParams<{ id: string }>();
  const accessToken = useAuthStore((s) => s.accessToken);

  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ id: string; type: string }[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [runBanner, setRunBanner] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Load workflow + credentials
  useEffect(() => {
    if (!workflowId) return;
    (async () => {
      const [{ data: wfData }, { data: credData }] = await Promise.all([
        api.get(`/workflows/${workflowId}`),
        api.get('/credentials'),
      ]);
      setCredentials(credData.credentials);
      const wf = wfData.workflow;
      setName(wf.name);
      setIsActive(wf.isActive);
      setNodes(
        (wf.nodesJson as any[]).map((n) => ({
          id: n.id,
          type: 'flowNode',
          position: n.position ?? { x: 100, y: 100 },
          data: {
            label: n.label ?? n.type,
            nodeType: n.type,
            status: 'idle' as NodeStatus,
            params: n.params ?? {},
            credentialId: n.credentialId ?? null,
          },
        }))
      );
      setEdges(
        (wf.edgesJson as any[]).map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
          animated: false,
        }))
      );
    })();
  }, [workflowId]);

  // Real-time execution overlay via Socket.IO
  useEffect(() => {
    if (!accessToken) return;
    const socket = io(import.meta.env.VITE_API_URL ?? 'http://localhost:4000', {
      path: '/ws/executions',
      auth: { token: accessToken },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    function setNodeStatus(nodeId: string, status: NodeStatus) {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n))
      );
    }

    socket.on('execution:started', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setRunBanner('Execution running…');
      setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, status: 'idle' } })));
    });
    socket.on('node:started', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setNodeStatus(e.nodeId, 'running');
    });
    socket.on('node:completed', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setNodeStatus(e.nodeId, 'success');
    });
    socket.on('node:failed', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setNodeStatus(e.nodeId, 'failed');
    });
    socket.on('node:skipped', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setNodeStatus(e.nodeId, 'skipped');
    });
    socket.on('execution:completed', (e: any) => {
      if (e.workflowId !== workflowId) return;
      setRunBanner('Execution finished — see history for details.');
      setTimeout(() => setRunBanner(null), 4000);
    });

    return () => {
      socket.disconnect();
    };
  }, [accessToken, workflowId]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds) as Node<FlowNodeData>[]),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );
  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, id: `e_${Date.now()}` }, eds)),
    []
  );

  function addNode(nodeType: string, label: string) {
    const id = nextId();
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: 'flowNode',
        position: { x: 120 + nds.length * 40, y: 120 + nds.length * 30 },
        data: { label, nodeType, status: 'idle', params: {}, credentialId: null },
      },
    ]);
  }

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
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
  }

  async function handleSave() {
    setSaveState('saving');
    const nodesPayload = nodes.map((n) => ({
      id: n.id,
      type: n.data.nodeType,
      label: n.data.label,
      position: n.position,
      params: n.data.params,
      credentialId: n.data.credentialId,
    }));
    const edgesPayload = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
    }));
    await api.put(`/workflows/${workflowId}`, { name, nodes: nodesPayload, edges: edgesPayload });
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 1500);
  }

  async function handleToggleActive() {
    const { data } = await api.post(`/workflows/${workflowId}/activate`, { isActive: !isActive });
    setIsActive(data.workflow.isActive);
  }

  async function handleRun() {
    await handleSave();
    await api.post(`/workflows/${workflowId}/execute`, {});
    setRunBanner('Execution enqueued…');
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="h-14 border-b border-panelBorder bg-panel flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/workflows" className="focus-ring text-muted hover:text-ink text-sm">
            ← Workflows
          </Link>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="focus-ring bg-transparent text-sm font-medium border-b border-transparent hover:border-panelBorder focus:border-signal px-1"
          />
          {isActive && (
            <span className="text-xs px-2 py-0.5 rounded-full border text-signal border-signal/40 bg-signal/10">
              Active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {runBanner && <span className="text-xs text-amber mr-2">{runBanner}</span>}
          <Link
            to={`/workflows/${workflowId}/executions`}
            className="focus-ring text-sm text-muted hover:text-ink px-3 py-1.5"
          >
            History
          </Link>
          <button
            onClick={handleToggleActive}
            className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder hover:border-signal/50 transition"
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
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <NodePalette onAdd={addNode} />
        <div className="flex-1 min-w-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            colorMode="dark"
            fitView
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        {selectedNode && (
          <NodeConfigPanel
            nodeId={selectedNode.id}
            nodeType={selectedNode.data.nodeType}
            label={selectedNode.data.label}
            params={selectedNode.data.params as Record<string, unknown>}
            credentialId={(selectedNode.data.credentialId as string) ?? null}
            credentials={credentials}
            onChange={updateSelectedNode}
            onDelete={deleteSelectedNode}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}
