import { randomUUID } from 'crypto';
import type {
  WorkflowGraph,
  WorkflowNode,
  WorkflowEdge,
  NodeItems,
  BinaryCollection,
  ExecutionJobData,
} from '@flowforge/shared-types';
import { resolveExpressions, type ExpressionErrorType } from './expressions';
import { NODE_REGISTRY } from '../nodes';
import { normalizeToItems, itemsToLegacyValue, decodeBinary, makeBinary } from '../nodes/types';
import { dispatchExecutionAlerts, dispatchLogStreamEvent } from '../utils/alerts';

/** Strips raw base64 `data` off binary metadata before it goes into expression
 *  context / logs — keeps `{{$binary.data.mimeType}}` etc. usable without
 *  putting megabytes of base64 into every expression evaluation. */
function stripBinaryData(binary: BinaryCollection | undefined): unknown {
  if (!binary) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, b] of Object.entries(binary) as [string, BinaryCollection[string]][]) {
    out[key] = { mimeType: b.mimeType, fileName: b.fileName, fileExtension: b.fileExtension, fileSize: b.fileSize };
  }
  return out;
}

const BINARY_PREVIEW_MAX_BYTES = 512 * 1024;

function binaryToPreview(binary: BinaryCollection | undefined): Record<string, unknown> | undefined {
  if (!binary) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, b] of Object.entries(binary)) {
    const isPreviewable = b.mimeType.startsWith('image/') || b.mimeType === 'application/pdf';
    const withinCap = (b.fileSize ?? 0) <= BINARY_PREVIEW_MAX_BYTES;
    out[key] = {
      mimeType: b.mimeType,
      fileName: b.fileName,
      fileExtension: b.fileExtension,
      fileSize: b.fileSize,
      preview: isPreviewable && withinCap ? b.data : undefined,
    };
  }
  return out;
}

function itemsToBinaryPreview(items: NodeItems): unknown {
  if (!items || items.length === 0) return undefined;
  return binaryToPreview(items[0].binary);
}

/** Binary summary (metadata only) for a full items array. */
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
  getExecutionStatus,
  markExecutionPaused,
  getPausedExecution,
  clearCheckpointAndMarkRunning,
  getDecryptedCredentialById,
  getWorkflow,
  getExecutionForRetry,
  getVariablesMapForWorkflow,
  getWorkflowStaticData,
  setWorkflowStaticData,
} from '../db/executions';

export type StatusEmitter = (event: {
  executionId: string;
  nodeId?: string;
  status: 'running' | 'success' | 'failed' | 'skipped' | 'started' | 'completed' | 'paused' | 'webhook-response' | 'cancelled';
  output?: unknown;
  input?: unknown;
  error?: string;
  durationMs?: number;
  itemCount?: number;
  expressionErrors?: { param: string; message: string; type: ExpressionErrorType }[];
  binary?: unknown;
}) => void;

type NodeStatus = 'success' | 'failed' | 'skipped';
const PAUSE_NODE_TYPES = new Set(['waitForWebhook', 'humanApproval']);
const MAX_SUBWORKFLOW_DEPTH = 5;

const NON_EXECUTABLE_NODE_TYPES = new Set(['stickyNote', 'group']);

function stripAnnotationNodes(nodes: WorkflowNode[], edges: WorkflowEdge[]): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const executableNodes = nodes.filter((n) => !NON_EXECUTABLE_NODE_TYPES.has(n.type));
  if (executableNodes.length === nodes.length) return { nodes, edges };
  const executableIds = new Set(executableNodes.map((n) => n.id));
  const executableEdges = edges.filter((e) => executableIds.has(e.source) && executableIds.has(e.target));
  return { nodes: executableNodes, edges: executableEdges };
}

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
  workspaceId: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  triggerPayload: unknown;
  emit: StatusEmitter;
  state: RunState;
  persist: boolean;
  nodeIdPrefix: string;
  depth: number;
  vars: Record<string, string>;
  staticData: Record<string, unknown>;
}

async function runLevels(opts: RunOptions): Promise<{ status: 'success' | 'failed' | 'paused' | 'cancelled' }> {
  const { executionId, workflowId, workspaceId, triggerPayload, emit, state, persist, nodeIdPrefix, depth, vars, staticData } = opts;
  const { nodes, edges } = stripAnnotationNodes(opts.nodes, opts.edges);
  const { outputs, nodeStatus, branchTaken } = state;
  const nodeMap = new Map<string, WorkflowNode>(nodes.map((n) => [n.id, n]));
  const incomingEdges = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    if (!incomingEdges.has(edge.target)) incomingEdges.set(edge.target, []);
    incomingEdges.get(edge.target)!.push(edge);
  }

  const levels = computeLevels(nodes, edges);
  let anyFailure = [...nodeStatus.values()].includes('failed');
  let cancelled = false;

  for (const level of levels) {
    const pending = level.filter((id) => !nodeStatus.has(id));
    if (pending.length === 0) continue;

    if (persist && !cancelled) {
      cancelled = (await getExecutionStatus(executionId)) === 'cancelled';
    }
    if (cancelled) {
      for (const nodeId of pending) {
        nodeStatus.set(nodeId, 'skipped');
        if (persist) await markNodeSkipped(executionId, nodeId);
        emit({ executionId, nodeId: nodeIdPrefix + nodeId, status: 'skipped' });
      }
      continue;
    }

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

  if (cancelled) return { status: 'cancelled' };
  anyFailure = anyFailure || [...nodeStatus.values()].includes('failed');
  return { status: anyFailure ? 'failed' : 'success' };

  async function processNode(nodeId: string): Promise<void> {
    const node = nodeMap.get(nodeId)!;
    const incoming = incomingEdges.get(nodeId) ?? [];
    const upstreamItemLists = incoming
      .filter((e) => nodeStatus.get(e.source) === 'success')
      .map((e) => outputs.get(e.source) ?? []);

    // Canonical item-paired input: concatenation of all successful upstream
    // branch items. Root nodes normalize the trigger payload into items.
    const items: NodeItems =
      triggerPayload !== undefined && incoming.length === 0
        ? normalizeToItems(triggerPayload)
        : upstreamItemLists.length === 0
          ? []
          : upstreamItemLists.flat();

    // Legacy unwrapped shape for backward compat (plugins that read `input` directly).
    const input = items.length === 0 ? null : itemsToLegacyValue(items);

    const nodeRunId = persist ? await upsertNodeRunStart(executionId, nodeId, input) : null;
    const startedAt = Date.now();
    emit({
      executionId,
      nodeId: nodeIdPrefix + nodeId,
      status: 'running',
      input,
      itemCount: items.length,
      binary: itemsToBinaryPreview(items),
    });

    if (node.isPinned) {
      const pinnedItems = normalizeToItems(node.pinnedOutput, nodeId);
      outputs.set(nodeId, pinnedItems);
      nodeStatus.set(nodeId, 'success');
      if (persist && nodeRunId) await finishNodeRunSuccess(nodeRunId, node.pinnedOutput);
      emit({
        executionId,
        nodeId: nodeIdPrefix + nodeId,
        status: 'success',
        output: node.pinnedOutput,
        durationMs: Date.now() - startedAt,
        itemCount: pinnedItems.length,
        binary: itemsToBinaryPreview(pinnedItems),
      });
      return;
    }

    try {
      const credential = node.credentialId ? await getDecryptedCredentialById(node.credentialId) : null;

      // Build $node[label] and $node[id] lookup maps — each carries the
      // first item's json (representative for expressions) plus binary metadata.
      const nodesByLabel: Record<string, { json: unknown; binary?: unknown }> = {};
      const nodesById: Record<string, { json: unknown; binary?: unknown }> = {};
      for (const n of nodes) {
        const label = n.label ?? n.type;
        const nOutputItems = outputs.get(n.id);
        if (nOutputItems) {
          // Use the FIRST item's json as the representative value for $node lookups
          // so $node["Label"].json.field works naturally (same as n8n's NDV).
          const firstJson = nOutputItems.length > 0 ? nOutputItems[0].json : null;
          const resolved = { json: firstJson, binary: nOutputItems.length > 0 ? stripBinaryData(nOutputItems[0].binary) : undefined };
          nodesByLabel[label] = resolved;
          nodesById[n.id] = resolved;
        }
      }

      // ── Per-item expression resolution (audit area 1) ──────────────────────
      // Resolve expressions once per input item so $json.field correctly refers
      // to THAT item's data, not the whole batch. For nodes with no items (root
      // trigger nodes) or a single item, this degenerates to one resolve call —
      // same as before. For multi-item batches it produces per-item resolved
      // params, and each item's result is collected separately.
      //
      // n8n reference: WorkflowExecute resolves params inside the per-item loop
      // with getNodeParameter(name, itemIndex), making itemIndex the key
      // disambiguation for $json resolution (audit section 1 / INodeExecutionData).
      const expressionErrors: { param: string; message: string; type: ExpressionErrorType }[] = [];

      const effectiveItems = items.length > 0 ? items : [{ json: null }];

      const perItemResults: Array<{ output?: unknown; items?: NodeItems; branch?: string } | null> = [];

      for (let itemIndex = 0; itemIndex < effectiveItems.length; itemIndex++) {
        const currentItem = effectiveItems[itemIndex];
        const exprCtx = {
          // $json = this item's json, not the whole batch — fixes the core
          // "not passing value of one node to other" issue (audit area 1).
          json: currentItem.json,
          // $item = the full INodeExecutionData object for this item,
          // including binary and pairedItem lineage.
          item: currentItem,
          env: process.env,
          workflow: { id: workflowId },
          execution: { id: executionId },
          nodesByLabel,
          nodesById,
          binary: 'binary' in currentItem ? stripBinaryData(currentItem.binary) : undefined,
          vars,
          staticData,
        };

        const resolvedParams = await resolveExpressions(node.params ?? {}, exprCtx, {
          onError: (err) => {
            // Dedupe expression errors across items (same param failing on every
            // item is one logical error, not N identical errors).
            if (!expressionErrors.some((e) => e.param === err.param && e.type === err.type)) {
              expressionErrors.push(err);
            }
          },
        });

        // ── Sub-node (non-main) connection resolution ───────────────────────
        // Any node type can have "sub-input" ports (model/memory/tool/
        // embedding/textSplitter/vectorStore/outputParser — see
        // connectionTypes.ts) drawn as diamond handles instead of the main
        // dot handle. Previously these were purely cosmetic: the executor
        // only ever walked `main` edges, so wiring e.g. a Redis Chat Memory
        // node into an Agent's Memory port did nothing at runtime. Here we
        // collect every non-main incoming edge's already-computed source
        // output, grouped by target handle id, so node plugins (ragNode.ts,
        // agentNode.ts) can read `params.$subNodes.<handleId>` and actually
        // honor what's wired on the canvas. Multiple connections to the same
        // handle (e.g. several Tool nodes) collect into an array; a single
        // connection stays a plain object for convenience.
        const subNodesByHandle: Record<string, unknown[]> = {};
        for (const edge of incoming) {
          const handle = edge.targetHandle;
          if (!handle || handle === 'main-in') continue; // main pipe, not a sub-node port
          const sourceItems = nodeStatus.get(edge.source) === 'success' ? outputs.get(edge.source) : undefined;
          if (!sourceItems || sourceItems.length === 0) continue;
          const sourceNode = nodeMap.get(edge.source);
          const value = { ...(sourceItems[0].json as Record<string, unknown>), $nodeType: sourceNode?.type };
          if (!subNodesByHandle[handle]) subNodesByHandle[handle] = [];
          subNodesByHandle[handle].push(value);
        }
        if (Object.keys(subNodesByHandle).length > 0) {
          const subNodes: Record<string, unknown> = {};
          for (const [handle, values] of Object.entries(subNodesByHandle)) {
            subNodes[handle] = values.length === 1 ? values[0] : values;
          }
          resolvedParams.$subNodes = subNodes;
        }

        const maxAttempts = Math.max(1, node.retry?.maxAttempts ?? 1);
        const retryDelayMs = node.retry?.delayMs ?? 1000;

        let result: { output?: unknown; items?: NodeItems; branch?: string } | null = null;
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            result = await dispatchNode(node, currentItem.json, [currentItem as NodeItems[0]], resolvedParams, credential, depth);
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
            perItemResults.push({ output: { error: lastError.message, continuedOnFail: true } });
          } else {
            // Surface the error with context about which item caused it.
            throw new Error(
              items.length > 1
                ? `Item ${itemIndex} of ${items.length}: ${lastError.message}`
                : lastError.message
            );
          }
        } else {
          perItemResults.push(result);
        }

        // For nodes that don't branch per-item (most nodes), break after the
        // first item — the plugin operates on the full items array internally.
        // Only true per-item nodes (set, transform, forEach-style) benefit from
        // the per-item loop. We detect this by checking if the plugin's result
        // items count matches 1 (it consumed one item). Otherwise break so we
        // don't call the plugin N times for a batch-oriented node.
        //
        // Heuristic: if items.length === 1 OR the plugin doesn't produce
        // per-item output (result.items is undefined), run once for the whole
        // batch. This keeps backward compat for all existing plugins.
        if (effectiveItems.length === 1 || (result && result.items === undefined && result.output !== undefined)) {
          // Run once for all items — the plugin already handles the batch.
          break;
        }
      }

      // Merge per-item results back into a unified output.
      const ranOnce = perItemResults.length === 1;
      const firstResult = perItemResults[0];

      if (firstResult !== null && firstResult !== undefined) {
        const resultItems = firstResult.items ?? normalizeToItems(firstResult.output, nodeId);
        outputs.set(nodeId, resultItems);
        if (firstResult.branch) branchTaken.set(nodeId, firstResult.branch);
        nodeStatus.set(nodeId, 'success');
        const legacyOutput = firstResult.items ? itemsToLegacyValue(resultItems) : firstResult.output;
        if (persist && nodeRunId) await finishNodeRunSuccess(nodeRunId, legacyOutput);
        emit({
          executionId,
          nodeId: nodeIdPrefix + nodeId,
          status: 'success',
          output: legacyOutput,
          durationMs: Date.now() - startedAt,
          itemCount: resultItems.length,
          binary: itemsToBinaryPreview(resultItems),
          expressionErrors: expressionErrors.length ? expressionErrors : undefined,
        });
      } else if (!ranOnce) {
        // continueOnFail path — all items produced error outputs.
        const softItems = perItemResults.map((r) => normalizeToItems(r?.output ?? { error: 'unknown' }, nodeId)).flat();
        outputs.set(nodeId, softItems);
        nodeStatus.set(nodeId, 'success');
        const softOutput = itemsToLegacyValue(softItems);
        if (persist && nodeRunId) await finishNodeRunSuccess(nodeRunId, softOutput);
        emit({
          executionId,
          nodeId: nodeIdPrefix + nodeId,
          status: 'success',
          output: softOutput,
          durationMs: Date.now() - startedAt,
          itemCount: softItems.length,
          expressionErrors: expressionErrors.length ? expressionErrors : undefined,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      nodeStatus.set(nodeId, 'failed');
      if (persist && nodeRunId) await finishNodeRunFailure(nodeRunId, message);
      emit({
        executionId,
        nodeId: nodeIdPrefix + nodeId,
        status: 'failed',
        error: message,
        durationMs: Date.now() - startedAt,
      });
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
    if (node.type === 'forEachBranch') {
      return runForEachBranch(node, params, input, emit, executionId, workflowId, workspaceId, depth, vars, staticData);
    }
    if (node.type === 'respondToWebhook') {
      return runRespondToWebhook(params, input, items, emit, executionId, nodeIdPrefix, node.id);
    }
    const plugin = NODE_REGISTRY[node.type];
    if (!plugin) throw new Error(`No node plugin registered for type "${node.type}"`);
    return plugin.execute({
      input,
      items,
      params,
      credential,
      getBinary: (item, key) => decodeBinary(item, key),
      toBinary: (buffer, mimeType, fileName) => makeBinary(buffer, mimeType, fileName),
      workflowId,
      workspaceId,
      staticData,
      setStaticData: (data) => setWorkflowStaticData(workflowId, data),
    });
  }
}

async function runRespondToWebhook(
  params: Record<string, unknown>,
  input: unknown,
  items: NodeItems,
  emit: StatusEmitter,
  executionId: string,
  nodeIdPrefix: string,
  nodeId: string
): Promise<{ output: unknown }> {
  const statusCode = typeof params.statusCode === 'number' ? params.statusCode : 200;
  const responseHeaders =
    params.responseHeaders && typeof params.responseHeaders === 'object'
      ? (params.responseHeaders as Record<string, string>)
      : undefined;
  const body = 'responseBody' in params ? params.responseBody : (input ?? {});

  emit({
    executionId,
    nodeId: nodeIdPrefix + nodeId,
    status: 'webhook-response',
    output: { statusCode, headers: responseHeaders, body },
  });

  return { output: input ?? {} };
}

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

async function runForEachBranch(
  node: WorkflowNode,
  params: Record<string, unknown>,
  input: unknown,
  emit: StatusEmitter,
  executionId: string,
  workflowId: string,
  workspaceId: string | null,
  depth: number,
  vars: Record<string, string>,
  staticData: Record<string, unknown>
): Promise<{ output: unknown }> {
  if (depth >= MAX_SUBWORKFLOW_DEPTH) {
    throw new Error(`forEachBranch: max nesting depth (${MAX_SUBWORKFLOW_DEPTH}) exceeded`);
  }
  const subgraph = params.subgraph as WorkflowGraph | undefined;
  if (!subgraph?.nodes?.length) {
    throw new Error('forEachBranch node: params.subgraph = { "nodes": [...], "edges": [...] } is required');
  }
  const sg = subgraph as WorkflowGraph;
  const itemsPath = params.itemsPath ? String(params.itemsPath) : '';
  const source = itemsPath
    ? itemsPath.split('.').reduce<unknown>((acc, k) => (acc as any)?.[k], input)
    : input;
  const items = Array.isArray(source) ? source : source == null ? [] : [source];
  const { nodes: sgExecNodes, edges: sgExecEdges } = stripAnnotationNodes(sg.nodes, sg.edges);
  const leaves = leafNodeIds(sgExecNodes, sgExecEdges);

  async function runOne(item: unknown, index: number): Promise<{ result: unknown; brk: boolean; skip: boolean }> {
    const state: RunState = { outputs: new Map(), nodeStatus: new Map(), branchTaken: new Map() };
      await runLevels({
        executionId,
        workflowId,
        workspaceId,
        nodes: sg.nodes,
        edges: sg.edges,
        triggerPayload: item,
        emit,
        state,
        persist: false,
        nodeIdPrefix: `${node.id}[${index}].`,
        depth: depth + 1,
        vars,
        staticData,
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

async function dispatchErrorWorkflow(
  workflowId: string,
  executionId: string,
  errorMessage?: string
): Promise<void> {
  try {
    const wf = await getWorkflow(workflowId);
    const errorWorkflowId = wf?.errorWorkflowId;
    if (!errorWorkflowId || errorWorkflowId === workflowId) return;
    const errorWf = await getWorkflow(errorWorkflowId);
    if (!errorWf) return;
    const graph: WorkflowGraph = { nodes: errorWf.nodesJson as WorkflowNode[], edges: errorWf.edgesJson as WorkflowEdge[] };
    await executeWorkflow(
      errorWorkflowId,
      graph,
      'manual',
      { failedWorkflowId: workflowId, executionId, errorMessage: errorMessage ?? null }
    );
  } catch (err) {
    console.error('[executor] failed to dispatch error workflow', err);
  }
}

export async function executeWorkflow(
  workflowId: string,
  graph: WorkflowGraph,
  triggerType: ExecutionJobData['triggerType'],
  triggerPayload: unknown,
  emit: StatusEmitter = () => {},
  depth = 0,
  presetExecutionId?: string
): Promise<{ executionId: string; status: 'success' | 'failed' | 'paused' | 'cancelled'; output?: unknown }> {
  const executionId = await createExecution(workflowId, triggerType, presetExecutionId);
  const wfRow = await getWorkflow(workflowId);
  const workspaceId = wfRow?.workspaceId ?? null;
  emit({ executionId, status: 'started' });
  await dispatchLogStreamEvent(workspaceId, { workflowId, executionId, status: 'started' });

  const vars = await getVariablesMapForWorkflow(workflowId);
  const staticData = await getWorkflowStaticData(workflowId);
  const state: RunState = { outputs: new Map(), nodeStatus: new Map(), branchTaken: new Map() };
  let result: { status: 'success' | 'failed' | 'paused' | 'cancelled' };
  try {
    result = await runLevels({
      executionId,
      workflowId,
      workspaceId,
      nodes: graph.nodes,
      edges: graph.edges,
      triggerPayload,
      emit,
      state,
      persist: true,
      nodeIdPrefix: '',
      depth,
      vars,
      staticData,
    });
  } catch (err) {
    await finishExecution(executionId, 'failed');
    await dispatchExecutionAlerts(workflowId, executionId, 'failed', (err as Error).message);
    await dispatchErrorWorkflow(workflowId, executionId, (err as Error).message);
    emit({ executionId, status: 'failed', error: (err as Error).message });
    await dispatchLogStreamEvent(workspaceId, { workflowId, executionId, status: 'failed', error: (err as Error).message });
    return { executionId, status: 'failed' };
  }

  if (result.status === 'paused') return { executionId, status: 'paused' };

  if (result.status === 'cancelled') {
    emit({ executionId, status: 'cancelled' });
    await dispatchLogStreamEvent(workspaceId, { workflowId, executionId, status: 'cancelled' });
    return { executionId, status: 'cancelled' };
  }

  const { nodes: execNodes, edges: execEdges } = stripAnnotationNodes(graph.nodes, graph.edges);
  const leaves = leafNodeIds(execNodes, execEdges);
  const leafOutputs = leaves.map((id) => itemsToLegacyValue(state.outputs.get(id) ?? []));
  const output = leafOutputs.length === 1 ? leafOutputs[0] : leafOutputs;

  await finishExecution(executionId, result.status);
  await dispatchExecutionAlerts(workflowId, executionId, result.status);
  if (result.status === 'failed') await dispatchErrorWorkflow(workflowId, executionId);
  emit({ executionId, status: 'completed', output, error: result.status === 'failed' ? 'Workflow execution failed' : undefined });
  await dispatchLogStreamEvent(workspaceId, {
    workflowId,
    executionId,
    status: result.status === 'failed' ? 'failed' : 'completed',
    error: result.status === 'failed' ? 'Workflow execution failed' : undefined,
  });
  return { executionId, status: result.status, output };
}

export async function resumeExecution(
  executionId: string,
  resumeInput: unknown,
  emit: StatusEmitter = () => {}
): Promise<{ executionId: string; status: 'success' | 'failed' | 'paused' | 'cancelled'; output?: unknown }> {
  const paused = await getPausedExecution(executionId);
  if (!paused) throw new Error(`No paused execution found with id ${executionId}`);
  const wf = await getWorkflow(paused.workflowId);
  if (!wf) throw new Error(`Workflow ${paused.workflowId} not found`);

  const checkpoint = paused.checkpoint as {
    outputs: Record<string, unknown>;
    nodeStatus: Record<string, NodeStatus>;
    branchTaken: Record<string, string>;
  };
  const state: RunState = {
    outputs: new Map(Object.entries(checkpoint.outputs ?? {})) as unknown as Map<string, NodeItems>,
    nodeStatus: new Map(Object.entries(checkpoint.nodeStatus ?? {})) as Map<string, NodeStatus>,
    branchTaken: new Map(Object.entries(checkpoint.branchTaken ?? {})),
  };
  state.outputs.set(paused.resumeNodeId, normalizeToItems(resumeInput, paused.resumeNodeId));
  state.nodeStatus.set(paused.resumeNodeId, 'success');

  await clearCheckpointAndMarkRunning(executionId);
  const workspaceId = wf.workspaceId ?? null;
  emit({ executionId, status: 'started', nodeId: paused.resumeNodeId, output: resumeInput });
  await dispatchLogStreamEvent(workspaceId, { workflowId: paused.workflowId, executionId, status: 'started' });

  const graph: WorkflowGraph = { nodes: wf.nodesJson as WorkflowNode[], edges: wf.edgesJson as WorkflowEdge[] };
  const vars = await getVariablesMapForWorkflow(paused.workflowId);
  const staticData = await getWorkflowStaticData(paused.workflowId);
  let result: { status: 'success' | 'failed' | 'paused' | 'cancelled' };
  try {
    result = await runLevels({
      executionId,
      workflowId: paused.workflowId,
      workspaceId,
      nodes: graph.nodes,
      edges: graph.edges,
      triggerPayload: undefined,
      emit,
      state,
      persist: true,
      nodeIdPrefix: '',
      depth: 0,
      vars,
      staticData,
    });
  } catch (err) {
    await finishExecution(executionId, 'failed');
    await dispatchExecutionAlerts(paused.workflowId, executionId, 'failed', (err as Error).message);
    await dispatchErrorWorkflow(paused.workflowId, executionId, (err as Error).message);
    emit({ executionId, status: 'failed', error: (err as Error).message });
    await dispatchLogStreamEvent(workspaceId, { workflowId: paused.workflowId, executionId, status: 'failed', error: (err as Error).message });
    return { executionId, status: 'failed' };
  }

  if (result.status === 'paused') return { executionId, status: 'paused' };
  if (result.status === 'cancelled') {
    emit({ executionId, status: 'cancelled' });
    await dispatchLogStreamEvent(workspaceId, { workflowId: paused.workflowId, executionId, status: 'cancelled' });
    return { executionId, status: 'cancelled' };
  }

  const { nodes: execNodes, edges: execEdges } = stripAnnotationNodes(graph.nodes, graph.edges);
  const leaves = leafNodeIds(execNodes, execEdges);
  const leafOutputs = leaves.map((id) => itemsToLegacyValue(state.outputs.get(id) ?? []));
  const output = leafOutputs.length === 1 ? leafOutputs[0] : leafOutputs;

  await finishExecution(executionId, result.status);
  await dispatchExecutionAlerts(paused.workflowId, executionId, result.status);
  if (result.status === 'failed') await dispatchErrorWorkflow(paused.workflowId, executionId);
  emit({ executionId, status: 'completed', output, error: result.status === 'failed' ? 'Workflow execution failed' : undefined });
  await dispatchLogStreamEvent(workspaceId, {
    workflowId: paused.workflowId,
    executionId,
    status: result.status === 'failed' ? 'failed' : 'completed',
    error: result.status === 'failed' ? 'Workflow execution failed' : undefined,
  });
  return { executionId, status: result.status, output };
}

export async function retryFromNode(
  originalExecutionId: string,
  retryNodeId: string,
  emit: StatusEmitter = () => {}
): Promise<{ executionId: string; status: 'success' | 'failed' | 'paused' | 'cancelled'; output?: unknown }> {
  const original = await getExecutionForRetry(originalExecutionId);
  if (!original) throw new Error(`Execution ${originalExecutionId} not found`);
  const wf = await getWorkflow(original.workflowId);
  if (!wf) throw new Error(`Workflow ${original.workflowId} not found`);

  const graph: WorkflowGraph = { nodes: wf.nodesJson as WorkflowNode[], edges: wf.edgesJson as WorkflowEdge[] };
  if (!graph.nodes.some((n: WorkflowNode) => n.id === retryNodeId)) {
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
  const workspaceId = wf.workspaceId ?? null;
  emit({ executionId, status: 'started' });
  await dispatchLogStreamEvent(workspaceId, { workflowId: original.workflowId, executionId, status: 'started' });

  const vars = await getVariablesMapForWorkflow(original.workflowId);
  const staticData = await getWorkflowStaticData(original.workflowId);
  let result: { status: 'success' | 'failed' | 'paused' | 'cancelled' };
  try {
    result = await runLevels({
      executionId,
      workflowId: original.workflowId,
      workspaceId,
      nodes: graph.nodes,
      edges: graph.edges,
      triggerPayload,
      emit,
      state,
      persist: true,
      nodeIdPrefix: '',
      depth: 0,
      vars,
      staticData,
    });
  } catch (err) {
    await finishExecution(executionId, 'failed');
    await dispatchExecutionAlerts(original.workflowId, executionId, 'failed', (err as Error).message);
    await dispatchErrorWorkflow(original.workflowId, executionId, (err as Error).message);
    emit({ executionId, status: 'failed', error: (err as Error).message });
    await dispatchLogStreamEvent(workspaceId, { workflowId: original.workflowId, executionId, status: 'failed', error: (err as Error).message });
    return { executionId, status: 'failed' };
  }

  if (result.status === 'paused') return { executionId, status: 'paused' };
  if (result.status === 'cancelled') {
    emit({ executionId, status: 'cancelled' });
    await dispatchLogStreamEvent(workspaceId, { workflowId: original.workflowId, executionId, status: 'cancelled' });
    return { executionId, status: 'cancelled' };
  }

  const { nodes: execNodes, edges: execEdges } = stripAnnotationNodes(graph.nodes, graph.edges);
  const leaves = leafNodeIds(execNodes, execEdges);
  const leafOutputs = leaves.map((id) => itemsToLegacyValue(state.outputs.get(id) ?? []));
  const output = leafOutputs.length === 1 ? leafOutputs[0] : leafOutputs;

  await finishExecution(executionId, result.status);
  await dispatchExecutionAlerts(original.workflowId, executionId, result.status);
  if (result.status === 'failed') await dispatchErrorWorkflow(original.workflowId, executionId);
  emit({ executionId, status: 'completed', output, error: result.status === 'failed' ? 'Workflow execution failed' : undefined });
  await dispatchLogStreamEvent(workspaceId, {
    workflowId: original.workflowId,
    executionId,
    status: result.status === 'failed' ? 'failed' : 'completed',
    error: result.status === 'failed' ? 'Workflow execution failed' : undefined,
  });
  return { executionId, status: result.status, output };
}