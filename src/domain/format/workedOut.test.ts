import { describe, expect, it } from 'vitest'

import { parseIdentity } from './identity.ts'
import {
  partOf,
  textOfWorkedOut,
  workedOutColumn,
  workedOutOfText,
  type WorkedOut,
} from './workedOut.ts'

/** The read, or the test's own failure — `undefined` is never what an assertion meant. */
function read(text: string): WorkedOut {
  const worked = workedOutOfText(text)
  if (worked === undefined) throw new Error(`${text} did not read as a worked-out column`)
  return worked
}

describe('workedOutOfText — the answering column', () => {
  it('reads the single column on the right as the answer', () => {
    expect(read('unit_price * quantity = line_total').column).toBe('line_total')
  })

  it('reads it on the left too, for a line somebody typed the other way round', () => {
    const worked = read('kcal = 4 * protein_g')
    expect(worked.column).toBe('kcal')
    expect(worked.parts).toEqual([partOf('protein_g', 4)])
  })

  it('refuses when neither side is a column on its own', () => {
    expect(workedOutOfText('4 * protein_g = 9 * kcal')).toBeUndefined()
  })

  it('refuses a hop as the answer — another row is not this row working something out', () => {
    expect(workedOutOfText('ingredient.kcal = 4 * protein_g')).toBeUndefined()
  })

  it('refuses a converted answer', () => {
    expect(workedOutOfText('amount_g = mass in g')).toBeUndefined()
  })
})

describe('workedOutOfText — the parts', () => {
  it('reads a weight and a column', () => {
    expect(read('4 * protein_g + 9 * fat_g = kcal').parts).toEqual([
      partOf('protein_g', 4),
      partOf('fat_g', 9),
    ])
  })

  it('reads a product of columns as one part', () => {
    expect(read('unit_price * quantity = line_total').parts).toEqual([
      { multiplier: 1, columns: ['unit_price', 'quantity'], less: undefined },
    ])
  })

  it('reads a cancelling pair as one part that takes a column off — Atwater', () => {
    const worked = read('4 * protein_g + 4 * carbs_g - 4 * fiber_g + 9 * fat_g = kcal')
    expect(worked.parts).toEqual([
      partOf('protein_g', 4),
      { multiplier: 4, columns: ['carbs_g'], less: 'fiber_g' },
      partOf('fat_g', 9),
    ])
  })

  it('leaves a part subtracted on its own when nothing cancels it', () => {
    expect(read('4 * protein_g - 9 * alcohol_g = kcal').parts).toEqual([
      partOf('protein_g', 4),
      partOf('alcohol_g', -9),
    ])
  })

  it('names a number reached through a link or a fold, because a part is just a name', () => {
    expect(read('amount_g * ingredient.kcal = kcal').parts).toEqual([
      { multiplier: 1, columns: ['amount_g', 'ingredient.kcal'], less: undefined },
    ])
    expect(read('2 * total_kcal = printed_kcal').parts).toEqual([partOf('total_kcal', 2)])
  })
})

describe('workedOutOfText — what falls to the text box', () => {
  it('refuses a divisor', () => {
    expect(workedOutOfText('total_kcal / servings = kcal')).toBeUndefined()
    expect(workedOutOfText('amount_g / 100 * ingredient.kcal = kcal')).toBeUndefined()
  })

  it('refuses a conversion on a part', () => {
    expect(workedOutOfText('amount in g via ingredient.density = mass_g')).toBeUndefined()
  })

  it('refuses a bare number, which names no column', () => {
    expect(workedOutOfText('printed_total + 5 = net')).toBeUndefined()
  })

  it('refuses what a balance itself will not draw', () => {
    expect(workedOutOfText('kcal / (protein_g + carbs_g) = ratio')).toBeUndefined()
  })

  it('refuses a line that does not parse at all', () => {
    expect(workedOutOfText('kcal =')).toBeUndefined()
    expect(workedOutOfText('')).toBeUndefined()
  })

  it('refuses two columns on the answering side', () => {
    expect(workedOutOfText('a * b = c + d')).toBeUndefined()
  })
})

describe('textOfWorkedOut — the round trip', () => {
  const lines = [
    'unit_price * quantity = line_total',
    '4 * protein_g + 9 * fat_g = kcal',
    '4 * protein_g + 4 * carbs_g - 4 * fiber_g + 9 * fat_g = kcal',
    '4 * protein_g - 9 * alcohol_g = kcal',
    'amount_g * ingredient.kcal = kcal',
    '2 * total_kcal = printed_kcal',
  ]

  for (const text of lines) {
    it(`writes ${text} back character for character`, () => {
      expect(textOfWorkedOut(read(text))).toBe(text)
    })
  }

  it('writes the answer on the right, whichever side it was read from', () => {
    expect(textOfWorkedOut(read('kcal = 4 * protein_g'))).toBe('4 * protein_g = kcal')
  })

  it('writes a line the identity grammar accepts', () => {
    const worked: WorkedOut = {
      column: 'kcal',
      parts: [{ multiplier: 4, columns: ['carbs_g'], less: 'fiber_g' }, partOf('fat_g', 9)],
    }
    const text = textOfWorkedOut(worked)
    expect(text).toBe('4 * carbs_g - 4 * fiber_g + 9 * fat_g = kcal')
    expect(parseIdentity(text)).not.toHaveProperty('problem')
  })

  it('ignores a column taken off a product, which is arithmetic the shape cannot say', () => {
    const worked: WorkedOut = {
      column: 'line_total',
      parts: [{ multiplier: 1, columns: ['unit_price', 'quantity'], less: 'discount' }],
    }
    expect(textOfWorkedOut(worked)).toBe('unit_price * quantity = line_total')
  })

  it('writes nothing for no parts, because half an equation is not an identity', () => {
    expect(textOfWorkedOut({ column: 'kcal', parts: [] })).toBe('')
  })
})

describe('workedOutColumn', () => {
  it('names the column, or nothing at all', () => {
    expect(workedOutColumn('4 * protein_g = kcal')).toBe('kcal')
    expect(workedOutColumn('total_kcal / servings = kcal')).toBeUndefined()
  })
})
