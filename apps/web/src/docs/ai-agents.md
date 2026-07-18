# AI agent depth

Everything below lives in `apps/worker/src/nodes/agentNode.ts` (three node types) plus a
small `apps/web/src/components/AgentTraceViewer.tsx` for visualizing what happened.

## 1. Persistent agent memory (short-term history + long-term vector recall)

Every `agent` run is scoped to a `sessionId`. Memory has two layers, both persisted to
disk per session (`AGENT_MEMORY_DIR`, default `/tmp/flowforge-agent-memory` — swap for
Redis/Postgres in a multi-instance deployment; `readMemory`/`writeMemory` are the only
functions that would need to change):

- **Short-term (conversation history)** — the last `recentTurns` turns (default 12) are
  replayed verbatim into the model's message list, oldest first, exactly like a normal
  chat thread.
- **Long-term (vector recall)** — every turn is embedded (`text-embedding-3-small`) when
  it's written. Before each run, the agent embeds the *current* prompt and
  cosine-similarity-ranks it against **every turn ever stored in that session**, not just
  the recent window, and injects the top `recallTopK` (default 4) matches as a system
  message. This is what lets a fact from 200 turns ago resurface only when it's actually
  relevant, instead of just falling out of context. Set `longTermMemory: false` to disable
  it for a run; embeddings are optional everywhere — if no OpenAI key is available the
  agent still runs on short-term memory alone.

The `agentMemory` node gives workflows manual control over the same store:

```
{ "action": "read",   "sessionId": "customer-42" }                          // recent turns
{ "action": "write",  "sessionId": "customer-42", "role": "user", "content": "..." }
{ "action": "clear",  "sessionId": "customer-42" }
{ "action": "recall", "sessionId": "customer-42", "query": "refund policy", "topK": 5 }  // vector search over ALL turns
```

`agentOrchestrator` stages all share one `sessionId`, so a sub-agent or reviewer stage can
long-term-recall something said in a *previous run* of the pipeline, not just this one.

## 2. Formal Tool abstraction

An `AgentToolSpec` (`{ name, nodeType, description, parameters }`) describes any
`NODE_REGISTRY` entry as an OpenAI function-calling tool. The agent loop dispatches the
model's chosen tool call straight through the node registry (`runTool` in
`agentNode.ts`), so a Slack/Notion/HTTP/Postgres/community node becomes a callable agent
tool with zero bespoke integration code:

```json
{
  "prompt": "Tell the #ops channel the deploy finished",
  "tools": [
    {
      "name": "post_to_slack",
      "nodeType": "slack",
      "description": "Post a message to Slack",
      "parameters": { "text": { "type": "string" } },
      "credential": { "webhookUrl": "https://hooks.slack.com/..." }
    }
  ]
}
```

## 3. Multi-agent orchestration

`agentOrchestrator` runs a planner → N sub-agents → reviewer pipeline:

1. **Planner** — breaks `goal` into a JSON list of `{ agent, task }` routed to your
   named `subAgents`.
2. **Sub-agents** — each runs as its own `agent` invocation with its own
   `systemPrompt`/`tools`, sharing the pipeline's memory session.
3. **Reviewer** — synthesizes all sub-agent outputs (and flags contradictions) into
   `finalAnswer`.

```json
{
  "goal": "Research the top 3 competitors and draft a positioning summary",
  "subAgents": [
    { "name": "researcher", "systemPrompt": "You research companies using the web_search tool.", "tools": [] },
    { "name": "writer", "systemPrompt": "You write clear, concise positioning summaries." }
  ]
}
```

## 4. Reasoning trace / visualization

Both `agent` and `agentOrchestrator` return a structured `trace` array in their output.
For a plain `agent`: a `recall` entry (if long-term memory surfaced anything) followed by
`tool_call` entries for each tool invocation and a final `final` entry. For
`agentOrchestrator`: one entry per `stage` (`planner`, `subAgent:<name>`, `reviewer`),
each carrying its own nested `trace`.

`AgentTraceViewer` (used in the node config panel's "Test node" result and in the
Execution History per-node Output panel) renders this as a readable timeline — recall
matches with similarity scores, each tool call's args/result, the plan, and the final
answer — instead of raw JSON. Raw JSON is still one click away via a collapsed "Raw JSON
output" toggle for debugging.
