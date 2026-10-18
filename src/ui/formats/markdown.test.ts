import { describe, expect, it } from 'vitest'

import { parseInline, parseMarkdown } from './markdown.ts'

/** A long text column read as markdown on the entry page (M26 U6, D-294). */

describe('parseMarkdown', () => {
  it('reads headings, paragraphs, lists, quotes, code and rules', () => {
    const blocks = parseMarkdown(
      [
        '# Method',
        '',
        'Boil the water',
        'and salt it.',
        '',
        '- one',
        '- two',
        '  carried on',
        '',
        '1. first',
        '2. second',
        '',
        '> a quote',
        '',
        '```',
        '**not bold**',
        '```',
        '',
        '---',
        '#### deep',
      ].join('\n'),
    )
    expect(blocks.map((each) => each.kind)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'quote',
      'code',
      'rule',
      'heading',
    ])
    expect(blocks[1]).toEqual({ kind: 'paragraph', children: [{ kind: 'text', text: 'Boil the water and salt it.' }] })
    expect(blocks[2]).toEqual({
      kind: 'list',
      ordered: false,
      items: [
        [{ kind: 'text', text: 'one' }],
        [
          { kind: 'text', text: 'two' },
          { kind: 'text', text: ' ' },
          { kind: 'text', text: 'carried on' },
        ],
      ],
    })
    expect(blocks[3]).toMatchObject({ kind: 'list', ordered: true })
    expect(blocks[5]).toEqual({ kind: 'code', text: '**not bold**' })
    expect(blocks[7]).toMatchObject({ kind: 'heading', level: 3 })
  })

  it('reads nothing from a blank text', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('  \n\n ')).toEqual([])
  })

  it('keeps markup as text, never as something to run', () => {
    expect(parseMarkdown('<script>alert(1)</script>')).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: '<script>alert(1)</script>' }] },
    ])
  })

  it('reads Hebrew as it reads anything else', () => {
    expect(parseMarkdown('## שיטה\n\nלבשל **עשר** דקות')).toEqual([
      { kind: 'heading', level: 2, children: [{ kind: 'text', text: 'שיטה' }] },
      {
        kind: 'paragraph',
        children: [
          { kind: 'text', text: 'לבשל ' },
          { kind: 'strong', children: [{ kind: 'text', text: 'עשר' }] },
          { kind: 'text', text: ' דקות' },
        ],
      },
    ])
  })
})

describe('parseInline', () => {
  it('reads bold, italic, code and links', () => {
    expect(parseInline('a **b** *c* `d*e*` [f](https://x.test)')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'b' }] },
      { kind: 'text', text: ' ' },
      { kind: 'em', children: [{ kind: 'text', text: 'c' }] },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'd*e*' },
      { kind: 'text', text: ' ' },
      { kind: 'link', children: [{ kind: 'text', text: 'f' }], href: 'https://x.test' },
    ])
  })

  it('leaves a marker that never closes, and a snake_case name, as text', () => {
    expect(parseInline('2 * 3 and **open')).toEqual([{ kind: 'text', text: '2 * 3 and **open' }])
    expect(parseInline('price_currency_code')).toEqual([{ kind: 'text', text: 'price_currency_code' }])
  })
})
