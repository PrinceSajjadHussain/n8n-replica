import crypto from 'crypto';
import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath, setByPath } from '../engine/jsonPath';

/**
 * Crypto — n8n's hash/HMAC/sign node. Uses Node's built-in `crypto` module
 * only — no new dependency needed.
 *
 * ITEM-AWARE: runs once per item.
 *
 * params:
 *   operation: 'hash' | 'hmac' | 'sign' | 'randomBytes'   default 'hash'
 *   algorithm?: string       e.g. 'sha256' (default), 'sha1', 'md5', 'sha512' —
 *                             for 'sign', an asymmetric algorithm like 'RSA-SHA256'
 *   sourceField?: string     dot-path to the input string; defaults to the whole
 *                             item json if it's already a string
 *   secret?: string          HMAC key ('hmac') — static value; use a credential-backed
 *                             expression upstream (Set node) if this needs to stay secret
 *   privateKeyField?: string dot-path to a PEM private key, used by 'sign'
 *   encoding?: 'hex' | 'base64'   output encoding, default 'hex'
 *   destinationField?: string     default 'hash' / 'signature' / 'randomBytes' to match operation
 *   byteLength?: number        used by 'randomBytes', default 16
 */
export const cryptoNode: NodePlugin = {
  type: 'crypto',
  async execute({ items, params }) {
    const operation = String(params.operation ?? 'hash');
    const algorithm = String(params.algorithm ?? 'sha256');
    const sourceField = params.sourceField ? String(params.sourceField) : '';
    const encoding = params.encoding === 'base64' ? 'base64' : 'hex';
    const defaultDest = operation === 'sign' ? 'signature' : operation === 'randomBytes' ? 'randomBytes' : 'hash';
    const destinationField = params.destinationField ? String(params.destinationField) : defaultDest;

    const sourceItems = items.length > 0 ? items : [{ json: {} }];

    const outItems = sourceItems.map((item, i) => {
      const readSource = (): string => {
        const raw = sourceField ? getByPath(item.json, sourceField) : item.json;
        return typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
      };

      let result: unknown;
      if (operation === 'hash') {
        result = crypto.createHash(algorithm).update(readSource()).digest(encoding);
      } else if (operation === 'hmac') {
        const secret = String(params.secret ?? '');
        if (!secret) throw new Error('Crypto node: "hmac" operation requires params.secret');
        result = crypto.createHmac(algorithm, secret).update(readSource()).digest(encoding);
      } else if (operation === 'sign') {
        const keyField = params.privateKeyField ? String(params.privateKeyField) : '';
        const privateKey = keyField ? getByPath(item.json, keyField) : undefined;
        if (typeof privateKey !== 'string' || !privateKey) {
          throw new Error('Crypto node: "sign" operation requires params.privateKeyField pointing at a PEM private key on the item');
        }
        result = crypto.createSign(algorithm).update(readSource()).sign(privateKey, encoding);
      } else if (operation === 'randomBytes') {
        const byteLength = Number(params.byteLength ?? 16);
        result = crypto.randomBytes(byteLength).toString(encoding);
      } else {
        throw new Error(`Crypto node: unknown operation "${operation}"`);
      }

      const outJson: Record<string, unknown> = { ...item.json };
      setByPath(outJson, destinationField, result);
      return { json: outJson, binary: item.binary, pairedItem: item.pairedItem ?? { item: i } };
    });

    return { items: outItems };
  },
};

registerNode(cryptoNode);
