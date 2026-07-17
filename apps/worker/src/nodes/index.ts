// Importing each node module registers it (side effect) into NODE_REGISTRY.
import './triggerNodes';
import './httpRequest';
import './ifNode';
import './setNode';
import './codeNode';
import './mergeNode';
import './slackNode';
import './stubNodes';

export { NODE_REGISTRY } from './types';
export type { NodePlugin, NodeExecutionContext, NodeExecutionResult } from './types';
