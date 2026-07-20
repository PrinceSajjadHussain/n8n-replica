/**
 * Backfill sourceHandle on old IF/Switch edges (REMAINING_WORK.md #4).
 *
 * Background: before the typed multi-handle canvas system, FlowNode rendered
 * a single output handle per node with no `sourceHandle` id at all. The
 * worker's executor treats a missing `sourceHandle` as "always follow this
 * edge" (see engine/executor.ts: an edge is only skipped when
 * `edge.sourceHandle != null && edge.sourceHandle !== branchTaken`) — so any
 * IF/Switch edge saved before this change currently runs BOTH branches
 * unconditionally on every execution, which is silently wrong, not just a
 * cosmetic/visual issue.
 *
 * This script finds those edges and assigns the correct handle id so the
 * conditional actually takes effect:
 *   - IF nodes: exactly two outgoing main edges with no sourceHandle → the
 *     edge targeting the node positioned further up the canvas (smaller Y)
 *     becomes 'true', the other becomes 'false'. This matches the layout
 *     convention the old canvas used when a person dragged both branches out
 *     (true path above, false path below) and is the same heuristic n8n
 *     itself falls back to when re-importing legacy workflows.
 *   - Switch nodes: outgoing main edges with no sourceHandle, sorted by
 *     target Y ascending, get '0', '1', '2', 'fallback' in order (only the
 *     first 4 are assigned; anything beyond that is left untouched and
 *     logged as a case needing manual review).
 *
 * Deliberately conservative: a source node with only ONE outgoing edge and no
 * sourceHandle is left alone. Assigning it a guessed branch would make the
 * engine start SKIPPING it whenever the branch doesn't match, which is a
 * behavior change from "always ran" that could silently break a workflow
 * that a person is relying on. Ambiguous cases are printed for manual review
 * instead of guessed at.
 *
 * Usage:
 *   npx tsx scripts/backfillIfSwitchHandles.ts            # dry run, prints a plan
 *   npx tsx scripts/backfillIfSwitchHandles.ts --apply     # writes the changes
 *
 * Requires DATABASE_URL in the environment (same as the API server).
 */
import '../src/loadEnv';
import { pool } from '../src/db/pool';

interface WfNode {
  id: string;
  type: string;
  position?: { x: number; y: number };
}
interface WfEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

const SWITCH_HANDLE_ORDER = ['0', '1', '2', 'fallback'];

function planForWorkflow(nodes: WfNode[], edges: WfEdge[]): { edges: WfEdge[]; changed: boolean; notes: string[] } {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const notes: string[] = [];
  let changed = false;
  const nextEdges = edges.map((e) => ({ ...e }));

  const bySource = new Map<string, WfEdge[]>();
  for (const e of nextEdges) {
    if (e.sourceHandle != null) continue; // already has a handle, nothing to backfill
    const sourceNode = nodeById.get(e.source);
    if (!sourceNode || (sourceNode.type !== 'if' && sourceNode.type !== 'switch')) continue;
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    bySource.get(e.source)!.push(e);
  }

  for (const [sourceId, group] of bySource) {
    const sourceNode = nodeById.get(sourceId)!;
    if (group.length <= 1) {
      notes.push(
        `SKIP ${sourceNode.type} node ${sourceId}: only ${group.length} un-handled outgoing edge(s) — ` +
          `left alone (guessing would change it from "always runs" to conditional, a behavior change).`
      );
      continue;
    }

    // Sort by target node's Y position (undefined position sorts last).
    const sorted = group
      .slice()
      .sort((a, b) => (nodeById.get(a.target)?.position?.y ?? Infinity) - (nodeById.get(b.target)?.position?.y ?? Infinity));

    if (sourceNode.type === 'if') {
      if (sorted.length > 2) {
        notes.push(`SKIP if node ${sourceId}: ${sorted.length} un-handled outgoing edges (expected at most 2) — needs manual review.`);
        continue;
      }
      sorted[0].sourceHandle = 'true';
      if (sorted[1]) sorted[1].sourceHandle = 'false';
      changed = true;
      notes.push(`FIX if node ${sourceId}: -> true=${sorted[0].id}${sorted[1] ? `, false=${sorted[1].id}` : ''}`);
    } else {
      const assignable = sorted.slice(0, SWITCH_HANDLE_ORDER.length);
      assignable.forEach((e, i) => {
        e.sourceHandle = SWITCH_HANDLE_ORDER[i];
      });
      changed = true;
      notes.push(
        `FIX switch node ${sourceId}: -> ${assignable.map((e, i) => `${SWITCH_HANDLE_ORDER[i]}=${e.id}`).join(', ')}`
      );
      if (sorted.length > SWITCH_HANDLE_ORDER.length) {
        notes.push(
          `  NOTE: switch node ${sourceId} has ${sorted.length} un-handled edges, only the first ${SWITCH_HANDLE_ORDER.length} were assigned — remainder needs manual review.`
        );
      }
    }
  }

  return { edges: nextEdges, changed, notes };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { rows } = await pool.query<{ id: string; name: string; nodesJson: WfNode[]; edgesJson: WfEdge[] }>(
    `SELECT id, name, "nodesJson", "edgesJson" FROM "Workflow"`
  );

  let touched = 0;
  for (const wf of rows) {
    const { edges, changed, notes } = planForWorkflow(wf.nodesJson ?? [], wf.edgesJson ?? []);
    if (notes.length === 0) continue;
    console.log(`\nWorkflow ${wf.id} ("${wf.name}"):`);
    for (const n of notes) console.log(`  ${n}`);
    if (!changed) continue;
    touched++;
    if (apply) {
      await pool.query(`UPDATE "Workflow" SET "edgesJson" = $2, "updatedAt" = now() WHERE id = $1`, [
        wf.id,
        JSON.stringify(edges),
      ]);
    }
  }

  console.log(`\n${apply ? 'Applied' : 'Would apply'} changes to ${touched} workflow(s).`);
  if (!apply && touched > 0) console.log('Re-run with --apply to write these changes.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
