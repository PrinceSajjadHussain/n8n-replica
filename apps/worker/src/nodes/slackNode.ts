import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';

/**
 * Slack node — posts a real message via a Slack Incoming Webhook URL.
 * credential (type 'slack'): { webhookUrl: string }
 * params: { text: string }
 */
export const slackNode: NodePlugin = {
  type: 'slack',
  async execute({ params, credential }) {
    const webhookUrl = credential?.webhookUrl as string | undefined;
    if (!webhookUrl) throw new Error('slack node: credential with "webhookUrl" is required');
    const text = String(params.text ?? '');

    const response = await axios.post(
      webhookUrl,
      { text },
      { validateStatus: () => true, timeout: 10000 }
    );

    return { output: { status: response.status, body: response.data } };
  },
};

registerNode(slackNode);
