import { useState } from 'react';
import { api } from '../lib/api';
import CredentialFieldsForm from './CredentialFieldsForm';
import {
  CREDENTIAL_TYPES,
  CREDENTIAL_TYPE_META,
  defaultFieldValues,
  type CredentialType,
} from '../lib/credentialSchemas';

interface CreatedCredential {
  id: string;
  name: string;
  type: string;
}

interface Props {
  /** Pre-selects and locks the type to whatever the node needs, when known. */
  defaultType?: CredentialType;
  onClose: () => void;
  onCreated: (credential: CreatedCredential) => void;
}

/**
 * A trimmed-down version of the CredentialsPage create form, rendered as a
 * modal so a user configuring a node never has to leave the canvas to set
 * up the credential it needs. On success, the new credential is immediately
 * selected on the node via onCreated.
 */
export default function CredentialQuickCreateModal({ defaultType, onClose, onCreated }: Props) {
  const [type, setType] = useState<CredentialType>(defaultType ?? 'slack');
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>(defaultFieldValues(defaultType ?? 'slack'));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function handleTypeChange(next: CredentialType) {
    setType(next);
    setValues(defaultFieldValues(next));
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const fields = values;
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value.trim()) data[key] = value.trim();
    }

    setBusy(true);
    try {
      const { data: resp } = await api.post('/credentials', {
        type,
        name: name || undefined,
        data,
      });
      onCreated(resp.credential);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Could not save credential.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-panel border border-panelBorder rounded-xl p-5 w-full max-w-sm space-y-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">New credential</h2>
          <button type="button" onClick={onClose} className="focus-ring text-muted hover:text-ink text-sm">
            ✕
          </button>
        </div>

        {error && (
          <div className="text-alert text-xs bg-alert/10 border border-alert/30 rounded-md px-3 py-2">{error}</div>
        )}

        <div>
          <label className="block text-xs text-muted mb-1">Type</label>
          <select
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as CredentialType)}
            disabled={Boolean(defaultType)}
            className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm disabled:opacity-60"
          >
            {CREDENTIAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {CREDENTIAL_TYPE_META[t].label}
              </option>
            ))}
          </select>
          {defaultType && (
            <p className="text-muted text-[11px] mt-1">This node requires a {CREDENTIAL_TYPE_META[defaultType].label} credential.</p>
          )}
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">Name (optional)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`e.g. My ${CREDENTIAL_TYPE_META[type].label} account`}
            className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
          />
        </div>

        <CredentialFieldsForm type={type} values={values} onChange={setValues} />

        <div className="flex justify-end gap-2 pt-2 border-t border-panelBorder">
          <button
            type="button"
            onClick={onClose}
            className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder text-muted hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="focus-ring text-sm px-4 py-1.5 rounded-md bg-signal text-canvas font-medium hover:brightness-110 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save & use'}
          </button>
        </div>
      </form>
    </div>
  );
}
