import { getParamSchema } from './paramSchemas';
import { NODE_TYPE_TO_CREDENTIAL_TYPE } from './credentialSchemas';

/**
 * Node types whose credential is genuinely optional (the node has its own
 * "no auth" mode) even though they're listed in NODE_TYPE_TO_CREDENTIAL_TYPE
 * for pre-select/pre-filter purposes. Kept deliberately short and explicit
 * rather than trying to infer optionality from each node's param schema.
 */
const OPTIONAL_CREDENTIAL_NODE_TYPES = new Set(['httpRequest']);

export interface NodeIssue {
  /** Param field key the issue is about, or 'credential' for a missing-credential issue. */
  field: string;
  message: string;
}

/**
 * Computes n8n-style pre-flight "issues" for a node — problems that are
 * guaranteed to fail the node's execution, surfaced before the workflow is
 * ever run (as opposed to `expressionErrors`, which only exist after a run
 * has actually failed). Three checks, in order of how definite the failure
 * is:
 *
 *   1. A field marked `required: true` in its param schema is empty.
 *   2. A field's own `validate()` rejects its current value.
 *   3. The node type needs a credential (per NODE_TYPE_TO_CREDENTIAL_TYPE)
 *      and none is attached, unless it's in the optional-credential list.
 *
 * Fields hidden by `visibleIf` for the current params are skipped — an
 * empty field that isn't even shown isn't a real issue.
 *
 * This is deliberately conservative: only node types with a paramSchema
 * entry and `required`/`validate` on specific fields get real checks (see
 * the `required` field in paramSchemas.ts for which ones so far). A node
 * type with no schema entry, or no required/validate fields, simply
 * returns fewer/no issues — that's a coverage gap to close over time, not
 * a false "all clear".
 */
export function computeNodeIssues(
  nodeType: string,
  params: Record<string, unknown>,
  credentialId: string | null | undefined
): NodeIssue[] {
  const issues: NodeIssue[] = [];
  const schema = getParamSchema(nodeType);

  if (schema) {
    for (const field of schema.fields) {
      if (field.visibleIf && !field.visibleIf(params)) continue;
      const value = params[field.key];
      const isEmpty = value === undefined || value === null || value === '';

      if (field.required && isEmpty) {
        issues.push({ field: field.key, message: `${field.label} is required` });
        continue; // don't also run validate() against an empty required field
      }
      if (!isEmpty && field.validate) {
        const error = field.validate(value, params);
        if (error) issues.push({ field: field.key, message: error });
      }
    }
  }

  const credentialType = NODE_TYPE_TO_CREDENTIAL_TYPE[nodeType];
  if (credentialType && !credentialId && !OPTIONAL_CREDENTIAL_NODE_TYPES.has(nodeType)) {
    issues.push({ field: 'credential', message: 'No credential selected' });
  }

  return issues;
}