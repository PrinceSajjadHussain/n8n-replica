/**
 * Round-trip check for REMAINING_WORK.md's manual-QA item #2:
 *   "Agent + OpenAI (model) + Redis Memory + a Tool node → confirm diamonds
 *    render, colors match, '+' auto-wiring works, save/reload round-trips
 *    the wiring."
 *
 * This sandbox has no browser and no Postgres instance, so the canvas/DB
 * parts of that can't be driven end-to-end here. What CAN be verified
 * without either: the exact pure functions CanvasPage.tsx calls to go from
 * live React Flow edges -> saved JSON -> reconstructed React Flow edges
 * (`serializeEdgesForSave` / `deriveEdgesFromSaved` in
 * `lib/edgeSerialization.ts`), which is where the `targetHandle`-dropping
 * bug actually lived. Also exercises an IF node's true/false branch edges,
 * since those are the other case `resolvePortType`'s fallback-to-first-port
 * behavior could quietly get wrong.
 *
 * Run with: npx tsx apps/web/src/lib/__tests__/edgeRoundTrip.check.ts
 * (from the repo root, or anywhere — it has no relative-path or cwd
 * assumptions). Exits non-zero and prints a diff on any mismatch.
 */
import type { Edge } from '@xyflow/react';
import { serializeEdgesForSave, deriveEdgesFromSaved } from '../edgeSerialization';
import { NodeConnectionTypes } from '../connectionTypes';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${label}`);
  if (!pass) {
    failures++;
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Scenario A: Agent + OpenAI (model) + Redis Memory + a Tool node
// ---------------------------------------------------------------------------
{
  const nodeTypeById = new Map<string, string | undefined>([
    ['agent1', 'agent'],
    ['openai1', 'openai'],
    ['redis1', 'redisMemory'],
    ['tool1', 'httpRequest'], // a plain node acting as an ai_tool-compatible provider isn't modeled explicitly; using main-only here on purpose — see note below
  ]);

  const liveEdges: Edge[] = [
    // OpenAI's single `model` output -> Agent's `model` input
    { id: 'e1', source: 'openai1', target: 'agent1', sourceHandle: 'model', targetHandle: 'model' } as Edge,
    // Redis Memory's single `memory` output -> Agent's `memory` input
    { id: 'e2', source: 'redis1', target: 'agent1', sourceHandle: 'memory', targetHandle: 'memory' } as Edge,
  ];

  const saved = serializeEdgesForSave(liveEdges);
  check('save: e1 keeps sourceHandle+targetHandle', saved[0], {
    id: 'e1',
    source: 'openai1',
    target: 'agent1',
    sourceHandle: 'model',
    targetHandle: 'model',
  });
  check('save: e2 keeps sourceHandle+targetHandle', saved[1], {
    id: 'e2',
    source: 'redis1',
    target: 'agent1',
    sourceHandle: 'memory',
    targetHandle: 'memory',
  });

  // Simulate a round-trip through JSON (what actually happens via the API/DB).
  const roundTripped = JSON.parse(JSON.stringify(saved));
  const reconstructed = deriveEdgesFromSaved(roundTripped, nodeTypeById);

  check('load: e1 targetHandle survives (was the actual bug)', reconstructed[0].targetHandle, 'model');
  check('load: e1 resolves to ai_languageModel connection type', (reconstructed[0].data as any).connectionType, NodeConnectionTypes.AiLanguageModel);
  check('load: e1 gets non-main dashed styling (not undefined)', reconstructed[0].style !== undefined, true);

  check('load: e2 targetHandle survives', reconstructed[1].targetHandle, 'memory');
  check('load: e2 resolves to ai_memory connection type', (reconstructed[1].data as any).connectionType, NodeConnectionTypes.AiMemory);

  // The bug this catches: before the fix, targetHandle was never saved, so
  // after a reload e1.targetHandle would be `undefined` — meaning if the
  // Agent had a SECOND ai_languageModel-typed slot (it doesn't today, but
  // any node that does), the wire could silently reattach to the wrong one.
  // Simulate the OLD (buggy) save shape to prove the new code guards against it:
  const oldBuggySaved = saved.map(({ targetHandle: _drop, ...rest }) => rest as any);
  const oldBuggyReconstructed = deriveEdgesFromSaved(oldBuggySaved, nodeTypeById);
  check(
    'sanity: confirms the bug WOULD reappear if targetHandle were dropped again',
    oldBuggyReconstructed[0].targetHandle,
    undefined
  );
}

// ---------------------------------------------------------------------------
// Scenario B: IF node true/false branches keep their distinct sourceHandle
// ---------------------------------------------------------------------------
{
  const nodeTypeById = new Map<string, string | undefined>([
    ['if1', 'if'],
    ['a', 'noOp'],
    ['b', 'noOp'],
  ]);

  const liveEdges: Edge[] = [
    { id: 'eTrue', source: 'if1', target: 'a', sourceHandle: 'true', targetHandle: undefined } as Edge,
    { id: 'eFalse', source: 'if1', target: 'b', sourceHandle: 'false', targetHandle: undefined } as Edge,
  ];

  const saved = serializeEdgesForSave(liveEdges);
  const reconstructed = deriveEdgesFromSaved(JSON.parse(JSON.stringify(saved)), nodeTypeById);

  check('load: true-branch edge keeps sourceHandle "true"', reconstructed[0].sourceHandle, 'true');
  check('load: false-branch edge keeps sourceHandle "false"', reconstructed[1].sourceHandle, 'false');
  check('load: both resolve to main connection type (no dashed styling)', [
    (reconstructed[0].data as any).connectionType,
    (reconstructed[1].data as any).connectionType,
  ], [NodeConnectionTypes.Main, NodeConnectionTypes.Main]);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
