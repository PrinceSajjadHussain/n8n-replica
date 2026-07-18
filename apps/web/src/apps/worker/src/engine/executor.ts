import { randomUUID } from 'crypto';
import type { WorkflowGraph, WorkflowNode, WorkflowEdge, NodeItems, BinaryCollection } from '@flowforge/shared-types';
import { resolveExpressions } from './expressions';
import { NODE_REGISTRY } from '../nodes';
import { normalizeToItems, itemsToLegacyValue, decodeBinary, makeBinary } from '../nodes/types';
import { dispatchExecutionAlerts } from '../utils/alerts';

/** Strips raw base64 `data` off binary metadata before it goes into expression
 *  context / logs — keeps `{{$binary.data.mimeType}}` etc. usable without
 *  putting megabytes of base64 into every expression evaluation. */
function stripBinaryData(binary: BinaryCollection | undefined): unknown {
  if (!binary) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, b] of Object.entries(binary)) {
    out[key] = { mimeType: b.mimeType, fileName: b.fileName, fileExtension: b.fileExtension, fileSize: b.fileSize };
  }
  return out;
}

/** Binary summary (metadata only) for a full items array, matching the shape of `$json`/legacy value. */
function itemsToBinarySummary(items: NodeItems): unknown {
  if (!items || items.length === 0) return undefined;
  if (items.length === 1) return stripBinaryData(items[0].binary);
  return items.map((i) => stripBinaryData(i.binary));
}
import {
  createExecution,
  finishExecution,
  upsertNodeRunStart,
  finishNodeRunSuccess,
  finishNodeRunFailure,
  markNodeSkipped,
  markExecutionPaused,
  getPausedExecution,
  clearCheckpointAndMarkRunning,
  getDecryptedCredentialById,
  getWorkflow,
  getExecutionForRetry,
} from '../db/executions';

export type StatusEmitter = (event: {
  executionId: string;
  nodeId?: string;
  status: 'running' | 'success' | 'failed' | 'skipped' | 'started' | 'completed' | 'paused';
  output?: unknown;
  error?: string;
}) => void;

type NodeStatus = 'success' | 'failed' | 'skipped';
const PAUSE_NODE_TYPES = new Set(['waitForWebhook', 'humanApproval']);
const MAX_SUBWORKFLOW_DEPTH = 5;

/**
 * Groups nodes into dependency "levels" (waves): level 0 has no
 * dependencies, level N depends only on nodes in levels < N. All nodes in
 * the same level are independent of each other and are executed truly in
 * parallel (Promise.all), giving real concurrent-branch execution. A
 * `merge` node naturally waits for every branch because it can only reach
 * a level once every incoming edge's source level has completed.
 * Throws if the graph contains a cycle.
 */
function computeLevels(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[][] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !inDegree.has(edge.target)) continue;
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const levels: string[][] = [];
  let frontier = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const remaining = new Map(inDegree);
  let processed = 0;

  while (frontier.length > 0) {
    levels.push(frontier);
    processed += frontier.length;
    const next: string[] = [];
    for (const id of frontier) {
      for (const target of adjacency.get(id) ?? []) {
        remaining.set(target, (remaining.get(target) ?? 0) - 1);
        if (remaining.get(target) === 0) next.push(target);
      }
    }
    frontier = next;
  }

  if (processed !== nodes.length) {
    throw new Error('Workflow graph contains a cycle — cannot execute (loops must use the forEachBranch node instead of a cyclic connection)');
  }
  return levels;
}

function leafNodeIds(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const hasOutgoing = new Set(edges.map((e) => e.source));
  return nodes.filter((n) => !hasOutgoing.has(n.id)).map((n) => n.id);
}

interface RunState {
  /** Each node's output as full items (json + binary + pairedItem lineage), the canonical dataflow shape. */
  outputs: Map<string, NodeItems>;
  nodeStatus: Map<string, NodeStatus>;
  branchTaken: Map<string, string>;
}

interface RunOptions {
  executionId: string;
  workflowId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  triggerPayload: unknown;
  emit: StatusEmitter;
  state: RunState;
  persist: boolean; // false for forEachBranch sub-runs: no DB node-run rows, lighter weight
  nodeIdPrefix: string; // for emit() visibility when running as a nested subgraph
  depth: number;
}

async function runLevels(opts: RunOptions): Promise<{ status: 'success' | 'failed' | 'paused' }> {
  const { executionId, workflowId, nodes, edges, triggerPayload, emit, state, persist, nodeIdPrefix, depth } = opts;
  const { outputs, nodeStatus, branchTaken } = state;
  const nodeMap = new Map<string, WorkflowNode>(nodes.map((n) => [n.id, n]));
  const incomingEdges = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    if (!incomingEdges.has(edge.target)) incomingEdges.set(edge.target, []);
    incomingEdges.get(edge.target)!.push(edge);
  }

  const levels = computeLevels(nodes, edges);
  let anyFailure = [...nodeStatus.values()].includes('failed');

  for (const level of levels) {
    const pending = level.filter((id) => !nodeStatus.has(id));
    if (pending.length === 0) continue;

    const toRun: string[] = [];
    for (const nodeId of pending) {
      const incoming = incomingEdges.get(nodeId) ?? [];
      let shouldSkip = false;
      if (incoming.length > 0) {
        shouldSkip = incoming.every((edge) => {
          const upstreamStatus = nodeStatus.get(edge.source);
          if (upstreamStatus === 'failed' || upstreamStatus === 'skipped') return true;
          const upstreamBranch = branchTaken.get(edge.source);
          if (edge.sourceHandle != null && upstreamBranch != null) return edge.sourceHandle !== upstreamBranch;
          return false;
        });
      }
      if (shouldSkip) {
        nodeStatus.set(nodeId, 'skipped');
        if (persist) await markNodeSkipped(executionId, nodeId);
        emit({ executionId, nodeId: nodeIdPrefix + nodeId, status: 'skipped' });
      } else {
        toRun.push(nodeId);
      }
    }
    if (toRun.length === 0) continue;

    const pauseNodeId = toRun.find((id) => PAUSE_NODE_TYPES.has(nodeMap.get(id)!.type));
    const runNow = pauseNodeId ? toRun.filter((id) => id !== pauseNodeId) : toRun;

    await Promise.all(runNow.map((nodeId) => processNode(nodeId)));

    if (pauseNodeId) {
      if (!persist) {
        nodeStatus.set(pauseNodeId, 'failed');
        anyFailure = true;
        emit({
          executionId,
          nodeId: nodeIdPrefix + pauseNodeId,
          status: 'failed',
          error: 'waitForWebhook/humanApproval is only supported at the top level of a workflow, not inside forEachBranch/subWorkflow.',
        });
      } else {
        const checkpoint = {
          outputs: Object.fromEntries(outputs),
          nodeStatus: Object.fromEntries(nodeStatus),
          branchTaken: Object.fromEntries(branchTaken),
        };
        const resumeToken = randomUUID();
        const node = nodeMap.get(pauseNodeId)!;
        const label = node.type === 'humanApproval' ? 'human approval' : 'external webhook';
        await markExecutionPaused(executionId, checkpoint, resumeToken, pauseNodeId);
        emit({
          executionId,
          nodeId: pauseNodeId,
          status: 'paused',
          output: { resumeToken, waitingFor: label },
        });
        return { status: 'paused' };
      }
    }
  }

  anyFailure = anyFailure || [...nodeStatus.values()].includes('failed');
  return { status: anyFailure ? 'failed' : 'success' };

  async function processNode(nodeId: string): Promise<void> {
    const node = nodeMap.get(nodeId)!;
    const incoming = incomingEdges.get(nodeId) ?? [];
    const upstreamItemLists = incoming
      .filter((e) => nodeStatus.get(e.source) === 'success')
      .map((e) => outputs.get(e.source) ?? []);

    // Canonical item-paired input: concatenation of every successful
    // upstream branch's items (each already carries its own pairedItem
    // lineage). Root nodes normalize the trigger payload into items.
    const items: NodeItems =
      triggerPayload !== undefined && incoming.length === 0
        ? normalizeToItems(triggerPayload)
        : upstreamItemLists.length === 0
          ? []
          : upstreamItemLists.flat();

    // Legacy unwrapped shape, preserved for existing plugins/expressions
    // that only know about `$json`/`input`: single item's json, or an
    // array of json blobs across items.
    const input = items.length === 0 ? null : itemsToLegacyValue(items);

    const nodeRunId = persist ? await upsertNodeRunStart(executionId, nodeId, input) : null;
    emit({ executionId, nodeId: nodeIdPrefix + nodeId, status: 'running' });

    if (node.isPinned) {
      // Pin Data: skip the real plugin call (and any credential/side
      // effect) entirely, and use the frozen output as-is.
      const pinnedItems = normalizeToItems(node.pinnedOutput, nodeId);
      outputs.set(nodeId, pinnedItems);
      nodeStatus.set(nodeId, 'success');
      if (persist && nodeRunId) await finishNodeRunSuccess(nodeRunId, node.pinnedOutput);
      emit({ executionId, nodeId: nodeIdPrefix + nodeId, status: 'success', output: node.pinnedOutput });
      return;
    }

    try {
      const credential = node.credentialId ? await getDecryptedCredentialById(node.credentialId) : null;

      const nodesByLabel: Record<string, { json: unknown; binary?: unknown }> = {};
      for (const n of nodes) {
        const label = n.label ?? n.type;
        const nOutputItems = outputs.get(n.id);
        if (nOutputItems) {
          nodesByLabel[label] = { json: itemsToLegacyValue(nOutputItems), binary: itemsToBinarySummary(nOutputItems) };
        }
      }
      const exprCtx = {
        json: input,
        env: process.env,
        workflow: { id: workflowId },
        execution: { id: executionId },
        nodesByLabel,
        binary: itemsToBinarySummary(items),
      };
      const resolvedParams = resolveExpressions(node.params ?? {}, exprCtx);

      const maxAttempts = Math.max(1, node.retry?.maxAttempts ?? 1);
      const retryDelayMs = node.retry?.delayMs ?? 1000;

      let result: { output?: unknown; items?: NodeItems; branch?: string } | null = null;
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          result = await dispatchNode(node, input, items, resolvedParams, credential, depth);
          lastError = null;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < maxAttempts) {
            emit({
              executionId,
              nodeId: nodeIdPrefix + nodeId,
              status: 'running',
              error: `attempt ${attempt}/${maxAttempts} failed: ${lastError.message} — retrying in ${retryDelayMs}ms`,
            });
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }
        }
      }

      if (lastError) {
        if (node.continueOnFail) {
          const softOutput = { error: lastError.message, continuedOnFail: true };
          outputs.set(nodeId, normalizeToItems(softOutput, nodeId));
          nodeStatus.set(nodeId, 'success');
          if (persist && nodeRunId) await finishNodeRunSuccess(nodeRunId, softOutput);
          emit({ executionId, nodeId: nodeIdPrefix + nodeId, status: 'success', output: softOutput });
        } else {
          throw lastError;
        }
      } else if (result) {
        const resultItems = result.items ?? normalizeToItems(result.output, nodeId);
        outputs.set(nodeId, resultItems);
        if (result.branch) branchTaken.set(nodeId, result.branch);
        nodeStatus.set(nodeId, 'success');
        const legacyOutput = result.items ? itemsToLegacyValue(resultItems) : result.output;
        if (persist && nodeRunId) await finishNodeRunSuccess(nodeRunId, legacyOutput);
        emit({ executionId, nodeId: nodeIdPrefix + nodeId, status: 'success', output: legacyOutput });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      nodeStatus.set(nodeId, 'failed');
      if (persist && nodeRunId) await finishNodeRunFailure(nodeRunId, message);
      emit({ executionId, nodeId: nodeIdPrefix + nodeId, status: 'failed', error: message });
    }
  }

  async function dispatchNode(
    node: WorkflowNode,
    input: unknown,
    items: NodeItems,
    params: Record<string, unknown>,
    credential: Record<string, unknown> | null,
    depth: number
  ): Promise<{ output?: unknown; items?: NodeItems; branch?: string }> {
    if (node.type === 'subWorkflow') return runSubWorkflow(params, input, emit, depth);
    if (node.type === 'forEachBranch') return runForEachBranch(node, params, input, emit, executionId, workflowId, depth);
    const plugin = NODE_REGISTRY[node.type];
    if (!plugin) throw new Error(`No node plugin registered for type "${node.type}"`);
    return plugin.execute({
      input,
      items,
      params,
      credential,
      getBinary: (item, key) => decodeBinary(item, key),
      toBinary: (buffer, mimeType, fileName) => makeBinary(buffer, mimeType, fileName),
    });
  }
}

/**
 * subWorkflow — "Execute Workflow" node. Runs another saved workflow
 * end-to-end as a real nested execution (visible in that workflow's own
 * execution history), passing this node's input as its trigger payload
 * and returning its leaf-node output(s). Depth-limited to prevent
 * A-calls-B-calls-A infinite recursion.
 * params: { workflowId: string }
 */
async function runSubWorkflow(
  params: Record<string, unknown>,
  input: unknown,
  emit: StatusEmitter,
  depth: number
): Promise<{ output: unknown }> {
  if (depth >= MAX_SUBWORKFLOW_DEPTH) {
    throw new Error(`subWorkflow: max nesting depth (${MAX_SUBWORKFLOW_DEPTH}) exceeded — check for a recursive call cycle`);
  }
  const targetId = String(params.workflowId ?? '');
  if (!targetId) throw new Error('subWorkflow node: "workflowId" param is required');
  const wf = await getWorkflow(targetId);
  if (!wf) throw new Error(`subWorkflow node: workflow ${targetId} not found`);

  const graph: WorkflowGraph = { nodes: wf.nodesJson as WorkflowNode[], edges: wf.edgesJson as WorkflowEdge[] };
  const result = await executeWorkflow(targetId, graph, 'manual', input, emit, depth + 1);
  if (result.status === 'paused') {
    throw new Error('subWorkflow node: the called workflow paused (waitForWebhook/humanApproval) — pausing inside a sub-workflow is not supported yet.');
  }
  return { output: { subExecutionId: result.executionId, status: result.status, result: result.output } };
}

/**
 * forEachBranch — TRUE loop: executes a self-contained subgraph
 * (params.subgraph.{nodes,edges}) once per item, running each item's
 * subgraph through the exact same level-based engine (so nested
 * forEachBranch nodes inside the subgraph work too — real nested loops).
 *
 * Break/continue: if a subgraph run's leaf output is (or contains)
 * `{ "__break": true }`, iteration stops after that item ("break"). A
 * leaf output of `{ "__skip": true }` excludes that item's result from
 * the collected output but continues to the next item ("continue").
 *
 * params:
 *   itemsPath?: string        dot-path into `input` for the array (default: input itself)
 *   subgraph: { nodes, edges } a mini workflow graph, same node types as the main canvas
 *   parallel?: boolean         run all items' subgraphs concurrently (default: false = sequential)
 */
async function runForEachBranch(
  node: WorkflowNode,
  params: Record<string, unknown>,
  input: unknown,
  emit: StatusEmitter,
  executionId: string,
  workflowId: string,
  depth: number
): Promise<{ output: unknown }> {
  if (depth >= MAX_SUBWORKFLOW_DEPTH) {
    throw new Error(`forEachBranch: max nesting depth (${MAX_SUBWORKFLOW_DEPTH}) exceeded`);
  }
  const maybeSubgraph = params.subgraph as WorkflowGraph | undefined;
  if (!maybeSubgraph?.nodes?.length) {
    throw new Error('forEachBranch node: params.subgraph = { "nodes": [...], "edges": [...] } is required');
  }
  const subgraph: WorkflowGraph = maybeSubgraph;
  const itemsPath = params.itemsPath ? String(params.itemsPath) : '';
  const source = itemsPath
    ? itemsPath.split('.').reduce<unknown>((acc, k) => (acc as any)?.[k], input)
    : input;
  const items = Array.isArray(source) ? source : source == null ? [] : [source];
  const leaves = leafNodeIds(subgraph.nodes, subgraph.edges);

  async function runOne(item: unknown, index: number): Promise<{ result: unknown; brk: boolean; skip: boolean }> {
    const state: RunState = { outputs: new Map(), nodeStatus: new Map(), branchTaken: new Map() };
    await runLevels({
      executionId,
      workflowId,
      nodes: subgraph.nodes,
      edges: subgraph.edges,
      triggerPayload: item,
      emit,
      state,
      persist: false,
      nodeIdPrefix: `${node.id}[${index}].`,
      depth: depth + 1,
    });
    const leafOutputs = leaves.map((id) => itemsToLegacyValue(state.outputs.get(id) ?? []));
    const merged = leafOutputs.length === 1 ? leafOutputs[0] : leafOutputs;
    const flagged = merged as { __break?: boolean; __skip?: boolean } | null;
    return { result: merged, brk: Boolean(flagged?.__break), skip: Boolean(flagged?.__skip) };
  }

  const results: unknown[] = [];
  if (params.parallel) {
    const all = await Promise.all(items.map((item, i) => runOne(item, i)));
    for (const r of all) if (!r.skip) results.push(r.result);
  } else {
    for (let i = 0; i < items.length; i++) {
      const r = await runOne(items[i], i);
      if (!r.skip) results.push(r.result);
      if (r.brk) break;
    }
  }

  return { output: { items: results, count: results.length } };
}

/**
 * Executes a workflow graph. See runLevels() for the core semantics
 * (parallel branches, skip propagation, retry, continue-on-fail,
 * expressions). This wrapper owns the top-level Execution row and the
 * pause/resume boundary — a paused run returns immediately with
 * status:'paused' and is later continued by resumeExecution().
 */
export async function executeWorkflow(
  workflowId: string,
  graph: WorkflowGraph,
  triggerType: 'manual' | 'webhook' | 'schedule' | 'emailTrigger' | 'fileWatcher' | 'databaseChange' | 'streamTrigger',
  triggerPayload: unknown,
  emit: StatusEmitter = () => {},
  depth = 0
): Promise<{ executionId: string; status: 'success' | 'failed' | 'paused'; output?: unknown }> {
  const executionId = await createExecution(workflowId, triggerType);
  emit({ executionId, status: 'started' });

  const state: RunState = { outputs: new Map(), nodeStatus: new Map(), branchTaken: new Map() };
  let result: { status: 'success' | 'failed' | 'paused' };
  try {
    result = await runLevels({
      executionId,
      workflowId,
      nodes: graph.nodes,
      edges: graph.edges,
      triggerPayload,
      emit,
      state,
      persist: true,
      nodeIdPrefix: '',
      depth,
    });
  } catch (err) {
    await finishExecution(executionId, 'failed');
    await dispatchExecutionAlerts(workflowId, executionId, 'failed', (err as Error).message);
    emit({ executionId, status: 'failed', error: (err as Error).message });
    return { executionId, status: 'failed' };
  }

  if (result.status === 'paused') {
    return { executionId, status: 'paused' };
  }

  const leaves = leafNodeIds(graph.nodes, graph.edges);
  const leafOutputs = leaves.map((id) => itemsToLegacyValue(state.outputs.get(id) ?? []));
  const output = leafOutputs.length === 1 ? leafOutputs[0] : leafOutputs;

  await finishExecution(executionId, result.status);
  await dispatchExecutionAlerts(workflowId, executionId, result.status);
  emit({ executionId, status: 'completed' });
  return { executionId, status: result.status, output };
}

/**
 * resumeExecution — continues a paused execution (waitForWebhook /
 * humanApproval) from its persisted checkpoint. Because the checkpoint
 * lives in Postgres (not worker memory), this works even if the worker
 * process restarted between pause and resume ("scheduled resume after
 * restart").
 */
export async function resumeExecution(
  executionId: string,
  resumeInput: unknown,
  emit: StatusEmitter = () => {}
): Promise<{ executionId: string; status: 'success' | 'failed' | 'paused'; output?: unknown }> {
  const paused = await getPausedExecution(executionId);
  if (!paused) throw new Error(`No paused execution found with id ${executionId}`);
  const wf = await getWorkflow(paused.workflowId);
  if (!wf) throw new Error(`Workflow ${paused.workflowId} not found`);

  const checkpoint = paused.checkpoint as {
    outputs: Record<string, NodeItems>;
    nodeStatus: Record<string, NodeStatus>;
    branchTaken: Record<string, string>;
  };
  const state: RunState = {
    outputs: new Map(Object.entries(checkpoint.outputs ?? {})) as Map<string, NodeItems>,
    nodeStatus: new Map(Object.entries(checkpoint.nodeStatus ?? {})) as Map<string, NodeStatus>,
    branchTaken: new Map(Object.entries(checkpoint.branchTaken ?? {})),
  };
  state.outputs.set(paused.resumeNodeId, normalizeToItems(resumeInput, paused.resumeNodeId));
  state.nodeStatus.set(paused.resumeNodeId, 'success');

  await clearCheckpointAndMarkRunning(executionId);
  emit({ executionId, status: 'started', nodeId: paused.resumeNodeId, output: resumeInput });

  const graph: WorkflowGraph = { nodes: wf.nodesJson as WorkflowNode[], edges: wf.edgesJson as WorkflowEdge[] };
  let result: { status: 'success' | 'failed' | 'paused' };
  try {
    result = await runLevels({
      executionId,
      workflowId: paused.workflowId,
      nodes: graph.nodes,
      edges: graph.edges,
      triggerPayload: undefined,
      emit,
      state,
      persist: true,
      nodeIdPrefix: '',
      depth: 0,
    });
  } catch (err) {
    await finishExecution(executionId, 'failed');
    await dispatchExecutionAlerts(paused.workflowId, executionId, 'failed', (err as Error).message);
    emit({ executionId, status: 'failed', error: (err as Error).message });
    return { executionId, status: 'failed' };
  }

  if (result.status === 'paused') return { executionId, status: 'paused' };

  const leaves = leafNodeIds(graph.nodes, graph.edges);
  const leafOutputs = leaves.map((id) => itemsToLegacyValue(state.outputs.get(id) ?? []));
  const output = leafOutputs.length === 1 ? leafOutputs[0] : leafOutputs;

  await finishExecution(executionId, result.status);
  await dispatchExecutionAlerts(paused.workflowId, executionId, result.status);
  emit({ executionId, status: 'completed' });
  return { executionId, status: result.status, output };
}

/**
 * retryFromNode — "execution replay": re-runs a past execution starting
 * at a specific node, reusing every OTHER node's recorded output instead
 * of re-executing it (so upstream API calls/side effects aren't repeated)
 * — the node you pick and everything downstream of it run fresh. Uses the
 * workflow's CURRENT saved graph (not a frozen historical copy), since
 * FlowForge doesn't version workflow definitions yet — if you've edited
 * the workflow since that run, the replay reflects the edits.
 *
 * Always creates a brand-new Execution row (visible in history
 * alongside the original), same as n8n/Make's "retry" producing a new
 * execution rather than mutating the old one.
 */
export async function retryFromNode(
  originalExecutionId: string,
  retryNodeId: string,
  emit: StatusEmitter = () => {}
): Promise<{ executionId: string; status: 'success' | 'failed' | 'paused'; output?: unknown }> {
  const original = await getExecutionForRetry(originalExecutionId);
  if (!original) throw new Error(`Execution ${originalExecutionId} not found`);
  const wf = await getWorkflow(original.workflowId);
  if (!wf) throw new Error(`Workflow ${original.workflowId} not found`);

  const graph: WorkflowGraph = { nodes: wf.nodesJson as WorkflowNode[], edges: wf.edgesJson as WorkflowEdge[] };
  if (!graph.nodes.some((n) => n.id === retryNodeId)) {
    throw new Error(`Node ${retryNodeId} no longer exists in the current workflow definition`);
  }

  const forwardAdjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!forwardAdjacency.has(edge.source)) forwardAdjacency.set(edge.source, []);
    forwardAdjacency.get(edge.source)!.push(edge.target);
  }
  const toRerun = new Set<string>();
  const queue = [retryNodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (toRerun.has(id)) continue;
    toRerun.add(id);
    for (const next of forwardAdjacency.get(id) ?? []) queue.push(next);
  }

  const historyByNode = new Map(original.nodeRuns.map((r) => [r.nodeId, r]));
  const state: RunState = { outputs: new Map(), nodeStatus: new Map(), branchTaken: new Map() };
  let triggerPayload: unknown;
  for (const node of graph.nodes) {
    if (toRerun.has(node.id)) {
      if (node.id === retryNodeId) triggerPayload = historyByNode.get(node.id)?.input;
      continue;
    }
    const historical = historyByNode.get(node.id);
    if (historical && historical.status !== 'failed') {
      state.outputs.set(node.id, normalizeToItems(historical.output, node.id));
      state.nodeStatus.set(node.id, historical.status);
    }
  }

  const executionId = await createExecution(original.workflowId, 'manual');
  emit({ executionId, status: 'started' });

  let result: { status: 'success' | 'failed' | 'paused' };
  try {
    result = await runLevels({
      executionId,
      workflowId: original.workflowId,
      nodes: graph.nodes,
      edges: graph.edges,
      triggerPayload,
      emit,
      state,
      persist: true,
      nodeIdPrefix: '',
      depth: 0,
    });
  } catch (err) {
    await finishExecution(executionId, 'failed');
    await dispatchExecutionAlerts(original.workflowId, executionId, 'failed', (err as Error).message);
    emit({ executionId, status: 'failed', error: (err as Error).message });
    return { executionId, status: 'failed' };
  }

  if (result.status === 'paused') return { executionId, status: 'paused' };

  const leaves = leafNodeIds(graph.nodes, graph.edges);
  const leafOutputs = leaves.map((id) => itemsToLegacyValue(state.outputs.get(id) ?? []));
  const output = leafOutputs.length === 1 ? leafOutputs[0] : leafOutputs;

  await finishExecution(executionId, result.status);
  await dispatchExecutionAlerts(original.workflowId, executionId, result.status);
  emit({ executionId, status: 'completed' });
  return { executionId, status: result.status, output };
}
