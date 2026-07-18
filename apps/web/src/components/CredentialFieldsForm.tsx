import { CREDENTIAL_FIELDS, type CredentialType } from '../lib/credentialSchemas';

interface Props {
  type: CredentialType;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}

/** Renders the labeled input fields for one credential type (password/text/select/info). */
export default function CredentialFieldsForm({ type, values, onChange }: Props) {
  return (
    <div className="space-y-3">
      {CREDENTIAL_FIELDS[type].map((field) =>
        field.fieldType === 'info' ? (
          <p
            key={field.key}
            className="text-muted text-xs bg-canvas border border-panelBorder rounded-md px-3 py-2"
          >
            {field.helpText}
          </p>
        ) : (
          <div key={field.key}>
            <label className="block text-xs text-muted mb-1">
              {field.label}
              {field.required && <span className="text-alert"> *</span>}
            </label>
            {field.fieldType === 'select' ? (
              <select
                value={values[field.key] ?? ''}
                onChange={(e) => onChange({ ...values, [field.key]: e.target.value })}
                className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm"
              >
                {field.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.fieldType === 'password' ? 'password' : 'text'}
                autoComplete="off"
                value={values[field.key] ?? ''}
                onChange={(e) => onChange({ ...values, [field.key]: e.target.value })}
                placeholder={field.placeholder}
                className="focus-ring w-full bg-canvas border border-panelBorder rounded-md px-3 py-2 text-sm font-display"
              />
            )}
            {field.helpText && <p className="text-muted text-[11px] mt-1">{field.helpText}</p>}
          </div>
        )
      )}
    </div>
  );
}
