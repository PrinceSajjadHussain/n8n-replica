import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
}

interface Props {
  workflowId: string;
  nodeId: string;
  /** params.path of the chatTrigger node, defaults to 'default' same as the API route. */
  path: string;
  onClose: () => void;
  /** Pins this turn's real input/output onto the chatTrigger node, same mechanism "Test Node" uses, so downstream nodes see real upstream data. */
  onPinResult?: (input: unknown, output: unknown) => void;
}

function replyToText(reply: unknown): string {
  if (reply === undefined || reply === null) return '(empty response)';
  if (typeof reply === 'string') return reply;
  // Common shapes: a "Respond to Webhook" payload, or a plain node output object/array.
  const obj = Array.isArray(reply) ? reply[0] : reply;
  if (obj && typeof obj === 'object') {
    const asRecord = obj as Record<string, unknown>;
    const candidate = asRecord.reply ?? asRecord.message ?? asRecord.answer ?? asRecord.text ?? asRecord.output;
    if (typeof candidate === 'string') return candidate;
  }
  try {
    return JSON.stringify(reply, null, 2);
  } catch {
    return String(reply);
  }
}

/**
 * n8n-style "Open Chat" test widget for the `chatTrigger` node. Talks to the
 * already-existing `POST /chat/test/:workflowId/:path` endpoint (runs the
 * current draft graph, no publish required), so this is purely a UI layer
 * on top of backend functionality that was already there.
 */
export default function ChatTestPanel({ workflowId, nodeId, path, onClose, onPinResult }: Props) {
  const sessionStorageKey = `session:${workflowId}:${nodeId}:chatSessionId`;
  const [sessionId] = useState<string>(() => {
    const existing = sessionStorage.getItem(sessionStorageKey);
    if (existing) return existing;
    const fresh = randomId();
    sessionStorage.setItem(sessionStorageKey, fresh);
    return fresh;
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setError(null);
    setInput('');
    setMessages((cur) => [...cur, { id: randomId(), role: 'user', content: message, ts: Date.now() }]);
    setBusy(true);
    try {
      const { data } = await api.post(`/chat/test/${workflowId}/${path || 'default'}`, {
        sessionId,
        message,
      });
      const replyText = replyToText(data.reply);
      setMessages((cur) => [...cur, { id: randomId(), role: 'assistant', content: replyText, ts: Date.now() }]);
      onPinResult?.({ sessionId, message, attachments: [] }, data.reply);
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Chat request failed — check the workflow and try again.';
      setError(msg);
      setMessages((cur) => [...cur, { id: randomId(), role: 'system', content: msg, ts: Date.now() }]);
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    const fresh = randomId();
    sessionStorage.setItem(sessionStorageKey, fresh);
    setMessages([]);
    setError(null);
    // Reload so the component re-mounts with a fresh sessionId — simplest
    // way to guarantee agentMemory/session-scoped nodes actually reset.
    window.location.reload();
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[380px] max-h-[70vh] flex flex-col bg-panel border border-panelBorder rounded-xl shadow-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-panelBorder flex items-center justify-between bg-canvas">
        <div>
          <p className="text-sm font-medium text-ink">💬 Test chat</p>
          <p className="text-[10px] text-muted">
            POST /chat/test/…/{path || 'default'} · session {sessionId.slice(0, 8)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleReset}
            title="Start a new session"
            className="focus-ring text-[11px] px-2 py-1 rounded-md border border-panelBorder text-muted hover:text-ink"
          >
            ↻ New session
          </button>
          <button onClick={onClose} className="focus-ring text-muted hover:text-ink text-sm px-1" aria-label="Close chat">
            ✕
          </button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-[200px]">
        {messages.length === 0 && (
          <p className="text-xs text-muted italic px-1">
            Send a message to manually trigger this workflow's draft graph — no need to publish it first.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                m.role === 'user'
                  ? 'bg-signal/20 text-ink border border-signal/30'
                  : m.role === 'system'
                    ? 'bg-alert/10 text-alert border border-alert/30 text-xs'
                    : 'bg-canvas text-ink border border-panelBorder'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-canvas border border-panelBorder rounded-lg px-3 py-2 text-xs text-muted animate-pulse">
              Running workflow…
            </div>
          </div>
        )}
      </div>

      {error && <p className="px-3 text-[11px] text-alert">{error}</p>}

      <div className="p-3 border-t border-panelBorder flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Type a message, or press ⏎ to send…"
          rows={1}
          className="focus-ring flex-1 bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm resize-none max-h-24"
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="focus-ring text-xs px-3 py-2 rounded-md border border-signal/40 text-signal hover:bg-signal/10 disabled:opacity-50 shrink-0"
        >
          Send
        </button>
      </div>
    </div>
  );
}