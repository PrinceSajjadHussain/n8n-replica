# Chatbot: Gemini + Redis conversation memory — testing guide

Template id: `gemini-chat-with-redis-memory` (Templates gallery → category "AI").
Nodes: `chatTrigger` → `redisMemory` (read) → `gemini` → `redisMemory` (write).

## 0. One-time setup

1. `.env`: make sure `REDIS_URL` is set (defaults to `redis://localhost:6379`,
   already used by the execution queue, so if `docker compose up -d redis` is
   running you don't need to change anything).
2. Credentials page → add a **Gemini** credential (`{ "apiKey": "..." }` from
   aistudio.google.com/apikey) and select it on the "Gemini Reply" node.
3. `redisMemory` needs no credential — it just uses `REDIS_URL`.

## 1. Test each node in isolation ("Run this node in isolation" + Mock input)

Paste these into each node's **Mock input (JSON object)** field, one at a
time, top to bottom — each node's mock output below is exactly what the next
node's mock input assumes, so testing them in order tells you immediately
which node is broken if something looks wrong.

### Node 1 — "When chat message received" (chatTrigger)
Mock input:
```json
{
  "sessionId": "test-session-1",
  "message": "Hi, my name is Sam. What's a good beginner hiking trail?",
  "attachments": []
}
```
Expected output: the same object, unchanged (chatTrigger just passes the
trigger payload through).

### Node 2 — "Read Memory" (redisMemory, action: read)
Mock input (simulating a brand-new session with no history yet):
```json
{ "sessionId": "test-session-1" }
```
Expected output on a fresh session:
```json
{ "turns": [], "historyText": "", "count": 0, "sessionId": "test-session-1" }
```
Run it a second time *for real* (not mocked) after Node 4 has written a turn,
and you should see `turns` populated with the prior exchange.

### Node 3 — "Gemini Reply" (gemini)
This node reads `{{$node["Read Memory"].json.historyText}}` and
`{{$node["When chat message received"].json.message}}` — those only resolve
when the whole workflow runs together, so when testing this node **alone**,
mock its input directly with the already-spliced prompt:
```json
{
  "value": "Conversation so far (may be empty for a new chat):\n\nUser: Hi, my name is Sam. What's a good beginner hiking trail?"
}
```
(Requires a real Gemini credential attached — this call is live, not
simulated, since it's testing the actual model integration.)
Expected output shape:
```json
{
  "text": "Hi Sam! ...",
  "parsed": null,
  "model": "gemini-2.0-flash",
  "usage": { "promptTokenCount": 0, "candidatesTokenCount": 0, "totalTokenCount": 0 },
  "finishReason": "STOP"
}
```

### Node 4 — "Save Memory" (redisMemory, action: write)
Mock input:
```json
{
  "sessionId": "test-session-1",
  "turns": [
    { "role": "user", "content": "Hi, my name is Sam. What's a good beginner hiking trail?" },
    { "role": "assistant", "content": "Hi Sam! A great beginner trail is..." }
  ]
}
```
Expected output:
```json
{
  "written": 2,
  "sessionId": "test-session-1",
  "reply": "Hi Sam! A great beginner trail is..."
}
```
`reply` is what a caller of `POST /chat/:workflowId/:path` actually receives
in the response body, since this write node is the workflow's last node.

## 2. End-to-end test (real run, not mocked)

1. Publish the workflow.
2. `POST https://<your-instance>/chat/<workflowId>/default`
   ```json
   { "sessionId": "sam-1", "message": "Hi, my name is Sam. What's a good beginner hiking trail?" }
   ```
   → `{ "reply": "...", "sessionId": "sam-1", "executionId": "..." }`
3. Send a second message with the **same** `sessionId`:
   ```json
   { "sessionId": "sam-1", "message": "What was my name again?" }
   ```
   A working memory wiring answers "Sam" — that's the proof the Redis
   round-trip (write in call 1 → read in call 2) is actually working, not
   just that Gemini answered something plausible.
4. To confirm persistence directly: `redis-cli LRANGE flowforge:chatmem:sam-1 0 -1`
   should show the two JSON turn objects written by call 1.

## 3. Common failure modes

- **`reply` is always empty on turn 2** → check the "Read Memory" node's
  `sessionId` param resolves to `{{$json.sessionId}}` (upstream = chatTrigger
  directly) and "Save Memory"/"Gemini Reply" use the fully-qualified
  `{{$node["When chat message received"].json.sessionId}}` — they're each
  more than one hop from the trigger, so a bare `{{$json...}}` there would
  read the *previous* node's output, not the trigger's.
- **`redisMemory node: params.sessionId is required` error** → the chat
  request body didn't include `sessionId` and something upstream mapped it
  to `undefined`; `chatTrigger` auto-generates one server-side if the caller
  omits it, but any hand-built mock input must still include the key.
- **Gemini call fails with "no API key"** → the Gemini credential isn't
  attached to the "Gemini Reply" node, and `GEMINI_API_KEY` isn't set on the
  worker either.
