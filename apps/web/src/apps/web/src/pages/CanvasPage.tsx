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
import NodeConfigPanel from '../components/NodeConfigPanel';
import CollabPanel from '../components/CollabPanel';

const nodeTypes = { flowNode: FlowNode, stickyNote: StickyNoteNode, group: GroupNode };
let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `node_${Date.now()}_${idCounter}`;
}

export default function CanvasPage() {
  const { id: workflowId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);

  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ id: string; type: string }[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [runBanner, setRunBanner] = useState<string | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [collabOpen, setCollabOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const historyRef = useRef<{ past: Array<{ nodes: Node<FlowNodeData>[]; edges: Edge[] }>; future: Array<{ nodes: Node<FlowNodeData>[]; edges: Edge[] }> }>({
    past: [],
    future: [],
  });
  const skipHistoryRef = useRef(false);

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
            retry: n.retry ?? null,
            continueOnFail: n.continueOnFail ?? false,
            isPinned: n.isPinned ?? false,
            pinnedOutput: n.pinnedOutput,
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

  /** Adds a freeform sticky note (UI-only annotation, not a real workflow
   *  node — `nodeType: 'note'` params stay empty so the executor never sees it
   *  since notes aren't wired into the execution graph via edges). */
  function addStickyNote() {
    const id = nextId();
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: 'stickyNote',
        position: { x: 160 + nds.length * 30, y: 160 + nds.length * 20 },
        style: { width: 200, height: 140 },
        data: { label: 'Note', nodeType: 'note', status: 'idle', params: {}, text: '' } as any,
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
    setNodes((nds) => [
      ...nds,
      {
        ...original,
        id,
        position: { x: original.position.x + 40, y: original.position.y + 40 },
        selected: false,
      },
    ]);
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
    const nodesPayload = nodes.map((n) => ({
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
    }));
    const edgesPayload = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
    }));
    await api.put(`/workflows/${workflowId}`, { name, nodes: nodesPayload, edges: edgesPayload });
    await api.post(`/workflows/${workflowId}/versions`, { nodesJson: nodesPayload, edgesJson: edgesPayload });
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 1500);
  }

  async function handleToggleActive() {
    const { data } = await api.post(`/workflows/${workflowId}/activate`, { isActive: !isActive });
    setIsActive(data.workflow.isActive);
  }

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
    await handleSave();
    await api.post(`/workflows/${workflowId}/execute`, {});
    setRunBanner('Execution enqueued…');
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
            { id: 'templates', label: 'Browse template gallery', group: 'Navigate', run: () => navigate('/templates') },
            { id: 'history', label: 'View execution history', group: 'Navigate', run: () => navigate(`/workflows/${workflowId}/executions`) },
            { id: 'workflows', label: 'Back to workflows', group: 'Navigate', run: () => navigate('/workflows') },
          ] as CommandItem[]
        }
      />
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
            onClick={() => setCollabOpen((v) => !v)}
            className={`focus-ring text-sm px-3 py-1.5 rounded-md border transition ${
              collabOpen ? 'border-signal/40 text-signal bg-signal/10' : 'border-panelBorder hover:border-signal/50'
            }`}
          >
            Versions & Comments
          </button>
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
            retry={(selectedNode.data.retry as { maxAttempts: number; delayMs: number } | null) ?? null}
            continueOnFail={Boolean(selectedNode.data.continueOnFail)}
            isPinned={Boolean(selectedNode.data.isPinned)}
            pinnedOutput={selectedNode.data.pinnedOutput}
            otherNodeLabels={nodes.filter((n) => n.id !== selectedNode.id).map((n) => n.data.label)}
            onChange={updateSelectedNode}
            onDelete={deleteSelectedNode}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
        {collabOpen && workflowId && (
          <CollabPanel workflowId={workflowId} onClose={() => setCollabOpen(false)} />
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
    </div>
  );
}
