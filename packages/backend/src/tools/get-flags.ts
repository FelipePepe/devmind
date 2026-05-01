import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { FlagsService } from '../flags/flags.js';

export function createGetFlagsTool(flags: FlagsService): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'get_flags',
    description: 'Return all feature flags and their current values',
    schema: z.object({}),
    func: async () => {
      const all = flags.listFlags();
      const result: Record<string, unknown> = {};
      for (const flag of all) {
        try {
          result[flag.key] = JSON.parse(flag.value) as unknown;
        } catch {
          result[flag.key] = flag.value;
        }
      }
      return JSON.stringify(result);
    },
  });
}
