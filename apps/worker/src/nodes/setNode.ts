import { registerNode } from './types';
import type { NodePlugin } from './types';
import { getByPath, setByPath } from '../engine/jsonPath';

/**
 * Set/Transform node — remaps and/or adds fields from the input into a new
 * output object.
 * params: { mappings: Array<{ targetPath: string, sourcePath?: string, staticValue?: unknown }> }
 * If `sourcePath` is given, the value is read from `input` at that dot path.
 * Otherwise `staticValue` is used verbatim.
 */
export const setNode: NodePlugin = {
  type: 'set',
  async execute({ input, params }) {
    const mappings = (params.mappings as Array<{
      targetPath: string;
      sourcePath?: string;
      staticValue?: unknown;
    }>) ?? [];

    const output: Record<string, unknown> = {};
    for (const mapping of mappings) {
      const value = mapping.sourcePath ? getByPath(input, mapping.sourcePath) : mapping.staticValue;
      setByPath(output, mapping.targetPath, value);
    }

    return { output };
  },
};

registerNode(setNode);
