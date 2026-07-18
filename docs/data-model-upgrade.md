# Step 1 — Data model fidelity: what changed

## 1. Binary/file data as a first-class type
`packages/shared-types/src/index.ts` adds `BinaryData` / `BinaryCollection`.
A `BinaryData` is `{ mimeType, fileName?, fileExtension?, fileSize?, data? (base64), directRef? }`.

- `apps/worker/src/nodes/types.ts` adds `getBinary(item, key?)` (decode to `Buffer`)
  and `toBinary(buffer, mimeType, fileName?)` (encode to `BinaryData`) to every
  node's execution context.
- `httpRequest` node: set `params.downloadBinary: true` to fetch the response
  as raw bytes instead of parsing JSON — the file lands in
  `item.binary.data` (key configurable via `binaryPropertyName`), never
  inlined into `json`.
- `set` and `code` nodes pass `item.binary` through untouched by default.
- Expressions can read binary **metadata** (never raw bytes) via
  `{{$binary.data.mimeType}}` / `{{$node["Label"].binary.data.fileName}}`.

## 2. Item-pairing model (array-of-items, not one JSON blob)
`NodeItem = { json, binary?, pairedItem? }`, `NodeItems = NodeItem[]`.

- The executor (`apps/worker/src/engine/executor.ts`) now stores each node's
  output as `NodeItems`, concatenating every successful upstream branch's
  items as input, and stamps `pairedItem: { item, sourceNode }` lineage on
  every item so you can trace an output item back to the input row it came
  from — same as n8n.
- **Fully backward compatible**: a node plugin that only reads `input` /
  returns `{ output }` keeps working unchanged — `normalizeToItems()` /
  `itemsToLegacyValue()` (`apps/worker/src/nodes/types.ts`) convert between
  the old single-blob shape and the new items array automatically. No
  existing node needed to change to keep running.
- Item-aware plugins should read `ctx.items` and return `{ items }` instead
  of `{ output }`. `setNode`, `httpRequestNode`, and `codeNode` were
  upgraded as reference implementations — `set` now runs once per input
  item (a 3-item input produces 3 linked output items), and the Code
  node's sandbox receives both legacy `input` and the full `items` array,
  and may return an items array itself.

## 3. Expression autocomplete / IntelliSense
`apps/web/src/components/ExpressionAutocomplete.tsx` — a dependency-free
`<textarea>` wrapper (no CodeMirror/Monaco needed) that opens a suggestion
dropdown as soon as you type `{{`, narrows results as you keep typing,
and accepts with Tab/Enter/click. Covers `$json`, `$binary`, `$item`,
`$env`, `$workflow.id`, `$execution.id`, `$now`/`$today`, every `$fn.*`
helper, and — dynamically, per node — `$node["<Label>"].json` /
`.binary` for every other node currently on the canvas.

Wired into the Params (JSON) field in `NodeConfigPanel.tsx`; the
"Test node" panel also now surfaces any binary attachments (📎 chips
showing filename/size) returned by an item-aware node.

## Known trade-offs (documented in code, not silently swallowed)
- Binary content travels as inline base64, not an external object store —
  fine for typical attachment/API-response sizes, but very large files
  should use `directRef` (left as an extension point) instead of `data`.
- `forEachBranch`/`subWorkflow` boundaries currently pass the *legacy*
  json value across the sub-execution boundary, so binary data doesn't
  survive a nested loop/sub-workflow hop yet (top-level and single-hop
  flows are fully binary-aware).
