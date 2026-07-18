import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import AppShell from '../components/AppShell';
import EmptyState from '../components/EmptyState';

type Scorer = 'jsonDiff' | 'exactString' | 'contains' | 'similarity';

const SCORER_LABEL: Record<Scorer, string> = {
  jsonDiff: 'Structural match (JSON diff)',
  exactString: 'Exact string match',
  contains: 'Contains substring',
  similarity: 'Similarity score (AI eval)',
};

interface TestCase {
  id: string;
  workflowId: string;
  name: string;
  input: unknown;
  expectedOutput: unknown;
  scorer: Scorer;
  passThreshold: number;
}

interface TestResult {
  testCaseId: string;
  name: string;
  executionId: string;
  pass: boolean;
  score?: number;
  message: string;
  diff?: { added: unknown; removed: unknown; changed: unknown } | null;
  actualOutput: unknown;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJsonInput(text: string): unknown {
  if (!text.trim()) return {};
  return JSON.parse(text);
}

/** Workflow-level test cases: save sample trigger inputs + expected
 *  outputs, then run the real workflow against each and see pass/fail —
 *  n8n Evaluations / a lightweight CI check for a workflow, including a
 *  "similarity" scorer usable as an AI-evaluation mode for agent/openai/
 *  RAG nodes whose output text won't be byte-identical between runs. */
export default function WorkflowTestsPage() {
  const { id: workflowId } = useParams<{ id: string }>();
  const [testCases, setTestCases] = useState<TestCase[] | null>(null);
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [running, setRunning] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<TestCase | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!workflowId) return;
    const { data } = await api.get(`/workflows/${workflowId}/tests`);
    setTestCases(data.testCases);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  async function runAll() {
    if (!workflowId) return;
    setRunning(true);
    setError(null);
    try {
      const { data } = await api.post(`/workflows/${workflowId}/tests/run`, {});
      const byId: Record<string, TestResult> = {};
      for (const r of data.results as TestResult[]) byId[r.testCaseId] = r;
      setResults(byId);
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Test run failed.');
    } finally {
      setRunning(false);
    }
  }

  async function runOne(testCaseId: string) {
    if (!workflowId) return;
    setRunning(true);
    setError(null);
    try {
      const { data } = await api.post(`/workflows/${workflowId}/tests/run`, { testCaseIds: [testCaseId] });
      const r = (data.results as TestResult[])[0];
      if (r) setResults((prev) => ({ ...prev, [r.testCaseId]: r }));
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Test run failed.');
    } finally {
      setRunning(false);
    }
  }

  async function deleteCase(tc: TestCase) {
    if (!confirm(`Delete test case "${tc.name}"?`)) return;
    await api.delete(`/workflows/${workflowId}/tests/${tc.id}`);
    setResults((prev) => {
      const next = { ...prev };
      delete next[tc.id];
      return next;
    });
    await load();
  }

  const passCount = Object.values(results).filter((r) => r.pass).length;
  const totalRun = Object.values(results).length;

  return (
    <AppShell>
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link to={`/workflows/${workflowId}`} className="focus-ring text-muted hover:text-ink text-sm">
              ← Back to editor
            </Link>
          </div>
          <h1 className="font-display text-2xl">Workflow tests</h1>
          <p className="text-sm text-muted mt-1">
            Save sample trigger inputs and expected outputs, then run the workflow against each one. Use the{' '}
            <span className="text-signal">similarity</span> scorer for AI-generated output that won&apos;t match
            exactly.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {totalRun > 0 && (
            <span className={`text-sm ${passCount === totalRun ? 'text-signal' : 'text-alert'}`}>
              {passCount}/{totalRun} passing
            </span>
          )}
          <button
            onClick={() => setShowNew(true)}
            className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder hover:border-signal/50 transition"
          >
            + New test case
          </button>
          <button
            onClick={runAll}
            disabled={running || !testCases?.length}
            className="focus-ring text-sm px-3 py-1.5 rounded-md bg-signal text-canvas font-medium hover:brightness-110 transition disabled:opacity-50"
          >
            {running ? 'Running…' : 'Run tests'}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-alert mb-4">{error}</p>}

      {testCases && testCases.length === 0 && (
        <EmptyState
          icon={<span>✅</span>}
          title="No test cases yet"
          description="Add a sample input and the output you expect, then hit Run tests any time you change this workflow to catch regressions."
          primaryAction={{ label: '+ New test case', onClick: () => setShowNew(true) }}
        />
      )}

      <div className="space-y-3">
        {testCases?.map((tc) => {
          const result = results[tc.id];
          return (
            <div key={tc.id} className="border border-panelBorder rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2.5 bg-panel">
                <div className="flex items-center gap-2 min-w-0">
                  {result && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${
                        result.pass
                          ? 'text-signal border-signal/40 bg-signal/10'
                          : 'text-alert border-alert/40 bg-alert/10'
                      }`}
                    >
                      {result.pass ? 'Pass' : 'Fail'}
                    </span>
                  )}
                  <p className="text-sm font-medium truncate">{tc.name}</p>
                  <span className="text-xs text-muted shrink-0">{SCORER_LABEL[tc.scorer]}</span>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => runOne(tc.id)}
                    disabled={running}
                    className="focus-ring text-xs px-2.5 py-1 rounded border border-panelBorder hover:border-signal/50 disabled:opacity-50"
                  >
                    Run
                  </button>
                  <button
                    onClick={() => setEditing(tc)}
                    className="focus-ring text-xs px-2.5 py-1 rounded border border-panelBorder text-muted hover:text-ink"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteCase(tc)}
                    className="focus-ring text-xs px-2.5 py-1 rounded border border-panelBorder text-muted hover:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {result && (
                <div className="px-3 py-2.5 border-t border-panelBorder space-y-2">
                  <p className={`text-xs ${result.pass ? 'text-signal' : 'text-alert'}`}>{result.message}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[11px] text-muted mb-1">Expected</p>
                      <pre className="text-[11px] bg-canvas border border-panelBorder rounded-md p-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">
                        {formatJson(tc.expectedOutput)}
                      </pre>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted mb-1">Actual</p>
                      <pre className="text-[11px] bg-canvas border border-panelBorder rounded-md p-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">
                        {formatJson(result.actualOutput)}
                      </pre>
                    </div>
                  </div>
                  {result.diff && (
                    <div>
                      <p className="text-[11px] text-muted mb-1">Diff</p>
                      <pre className="text-[11px] bg-canvas border border-panelBorder rounded-md p-2 max-h-32 overflow-auto whitespace-pre-wrap break-words">
                        {formatJson(result.diff)}
                      </pre>
                    </div>
                  )}
                  <Link
                    to={`/workflows/${workflowId}/executions`}
                    className="focus-ring text-[11px] text-signal inline-block"
                  >
                    View execution →
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(showNew || editing) && (
        <TestCaseModal
          workflowId={workflowId!}
          existing={editing}
          onClose={() => {
            setShowNew(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setShowNew(false);
            setEditing(null);
            await load();
          }}
        />
      )}
    </AppShell>
  );
}

function TestCaseModal({
  workflowId,
  existing,
  onClose,
  onSaved,
}: {
  workflowId: string;
  existing: TestCase | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [inputText, setInputText] = useState(formatJson(existing?.input ?? {}));
  const [expectedText, setExpectedText] = useState(formatJson(existing?.expectedOutput ?? {}));
  const [scorer, setScorer] = useState<Scorer>(existing?.scorer ?? 'jsonDiff');
  const [passThreshold, setPassThreshold] = useState(existing?.passThreshold ?? 0.7);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let input: unknown;
    let expectedOutput: unknown;
    try {
      input = parseJsonInput(inputText);
      expectedOutput = scorer === 'exactString' || scorer === 'contains' || scorer === 'similarity'
        ? tryParseOrRawString(expectedText)
        : parseJsonInput(expectedText);
    } catch {
      setError('Input and expected output must be valid JSON.');
      return;
    }
    try {
      const body = { name, input, expectedOutput, scorer, passThreshold };
      if (existing) {
        await api.patch(`/workflows/${workflowId}/tests/${existing.id}`, body);
      } else {
        await api.post(`/workflows/${workflowId}/tests`, body);
      }
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.error?.formErrors?.[0] ?? err.response?.data?.error ?? 'Could not save test case.');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-panel border border-panelBorder rounded-xl p-5 w-full max-w-lg space-y-3">
        <h3 className="font-medium">{existing ? 'Edit test case' : 'New test case'}</h3>
        <form onSubmit={save} className="space-y-3">
          <div>
            <label className="text-xs text-muted block mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="focus-ring w-full bg-transparent border border-panelBorder rounded-md px-2.5 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Trigger input (JSON)</label>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              rows={4}
              className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-2.5 py-1.5 text-xs font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Scorer</label>
            <select
              value={scorer}
              onChange={(e) => setScorer(e.target.value as Scorer)}
              className="focus-ring w-full bg-transparent border border-panelBorder rounded-md px-2.5 py-1.5 text-sm"
            >
              {(Object.keys(SCORER_LABEL) as Scorer[]).map((s) => (
                <option key={s} value={s}>
                  {SCORER_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">
              Expected {scorer === 'jsonDiff' ? 'output (JSON)' : 'text'}
            </label>
            <textarea
              value={expectedText}
              onChange={(e) => setExpectedText(e.target.value)}
              rows={4}
              className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-2.5 py-1.5 text-xs font-mono"
            />
          </div>
          {scorer === 'similarity' && (
            <div>
              <label className="text-xs text-muted block mb-1">Pass threshold (0-1)</label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={passThreshold}
                onChange={(e) => setPassThreshold(Number(e.target.value))}
                className="focus-ring w-full bg-transparent border border-panelBorder rounded-md px-2.5 py-1.5 text-sm"
              />
            </div>
          )}
          {error && <p className="text-xs text-alert">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder text-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="focus-ring text-sm px-3 py-1.5 rounded-md bg-signal text-canvas font-medium hover:brightness-110"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Expected-output field: try JSON first (so `{"a":1}` or `42` still work), fall back to the raw string for plain-text expectations like "refund policy". */
function tryParseOrRawString(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
