/**
 * **`format_problems`: what is wrong, on demand** — M34 U3, D-396.
 *
 * The same look `read_onto_format` takes after every read, for whenever it is
 * asked; the screen's half is the band on the format's page. Both are
 * `auditFormat`, so the two cannot disagree (D-227).
 */

import { auditFormat } from '@/data/repositories/formatAuditRepository.ts'
import { indexOf } from '@/data/repositories/formatJoinRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'

import { readDocument } from '../document.ts'
import { paragraphs } from '../format.ts'
import { auditText } from './intake.ts'
import { PATH_PROP, ToolInputError, requireString, type Args, type PluginTool } from './tool.ts'

function namesFrom(args: Args): readonly string[] | undefined {
  const given = args['formats']
  if (given === undefined || given === null) return undefined
  if (!Array.isArray(given) || given.some((each) => typeof each !== 'string')) {
    throw new ToolInputError('`formats` is a list of format names.')
  }
  return given as readonly string[]
}

export const formatProblemsTool: PluginTool = {
  definition: {
    name: 'format_problems',
    title: 'What looks wrong in declared formats',
    description:
      'What the engine can see is wrong in a format’s rows, without a rule anybody wrote: a link ' +
      'empty where most rows fill it, rows the same in every column, claims failed or ' +
      'unchecked. `read_onto_format` says it after every read. Reads only.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        formats: { type: 'array', items: { type: 'string' }, description: 'By name. Omit for every one.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const names = namesFrom(args)
    return readDocument(path, (document) => {
      const declared = listFormats(document.db)
      const unknown = (names ?? []).filter((name) => !declared.some((each) => each.name === name))
      if (unknown.length > 0) {
        return (
          `No format called ${unknown.map((name) => `\`${name}\``).join(', ')}. This document ` +
          `declares ${declared.map((each) => `\`${each.name}\``).join(', ') || 'none'}.`
        )
      }
      const chosen = names === undefined ? declared : declared.filter((each) => names.includes(each.name))
      if (chosen.length === 0) return 'This document declares no format yet.'
      const formats = indexOf(declared)
      return paragraphs(
        auditText(
          chosen.map((declaration) => auditFormat(document.db, declaration, formats)),
          false,
        ),
        'A rule only somebody knows — a project done while its tasks are not started — is not ' +
          'guessed here.',
      )
    })
  },
}
