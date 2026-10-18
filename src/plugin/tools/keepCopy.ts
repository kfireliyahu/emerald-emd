/**
 * **`keep_copy`: a copy from before, whenever it is asked** — M34 U6, D-399.
 *
 * A read or a batch of `NAMED_COPY_ROWS` rows or more keeps one by itself; this
 * is the same copy for anything else — a reshaping by hand, an afternoon of
 * small edits somebody wants a line under. The screen's half is the command
 * *Back up now*, and both name the file alike (`electron/bridge.ts`) and keep
 * it in the document's folder of earlier copies, never beside it (D-470).
 */

import { keepCopyNow } from '../write.ts'
import { PATH_PROP, optionalString, requireString, stringProp, type PluginTool } from './tool.ts'

export const keepCopyTool: PluginTool = {
  definition: {
    name: 'keep_copy',
    title: 'Back up a document now',
    description:
      'Backs the document up now: a copy as it is, in Emerald’s folder, named for what it comes before ' +
      '(`work.before-20261006T120512-cleanup.emd`), and says where. A read or batch of 100+ ' +
      'rows keeps one by itself; ask before anything else worth undoing. The last 3 are kept, ' +
      'apart from the rolling copies.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        before: stringProp('What it comes before, in a few words: `the cleanup`.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const before = optionalString(args, 'before')?.trim() || 'now'
    return keepCopyNow(path, before)
  },
}
