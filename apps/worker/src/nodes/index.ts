// Importing each node module registers it (side effect) into NODE_REGISTRY.
import './triggerNodes';
import './httpRequest';
import './ifNode';
import './setNode';
import './codeNode';
import './mergeNode';
import './slackNode';
import './openaiNode';
import './anthropicNode';
import './ragNode';
import './browserAutomationNode';
import './switchNode';
import './waitNode';
import './forEachNode';
import './moreIntegrations';
import './businessIntegrations';
import './cloudIntegrations';
import './agentNode';
import './emailNode';
import './googleSheetsNode';
import './dataTableNode';
import './fileNode';

import { loadCommunityNodes } from './communityLoader';
loadCommunityNodes();

export { NODE_REGISTRY } from './types';
export type { NodePlugin, NodeExecutionContext, NodeExecutionResult } from './types';
