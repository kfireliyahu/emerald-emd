/**
 * Management-fee benchmarks per fund type — the regulatory ceiling and what is
 * ordinarily negotiated.
 *
 * **Shipped with the app, overridable in the document** (D-066), which is the
 * posture D-046 took for the built-in rule packs and for the same two reasons:
 * nothing holds a foreign key to a benchmark, and a cap changes when the
 * regulator changes it rather than when a user does something. So it lives here
 * as data rather than in a migration, and a document that disagrees carries only
 * the disagreement.
 *
 * Nothing in `@/domain/funds.ts` imports this file. `feeBenchmark` is *given*
 * its references, so an override in the document outranks this table without the
 * domain knowing there was a table.
 *
 * **These numbers are stale the day the regulator moves**, which is why every
 * row carries `asOf` and `source` and why the screen shows both. docs/f13 is
 * explicit that a stale cap presented as current would be worse than no
 * benchmark at all. The typical figures are what the large funds advertise
 * rather than a survey, and are only ever shown as a reference point — the app
 * does not rank funds and does not recommend switching (docs/f13's deliberate
 * limit).
 */

import { localDate } from '@/core/time.ts'
import type { FeeReference } from '@/domain/model/funds.ts'

/**
 * Basis points throughout: 105 is 1.05%, 600 is 6%.
 *
 * The two caps per row are the two fees an Israeli fund may charge — one annual
 * slice of the accumulated balance, one slice of each deposit — and a fund
 * charging the ceiling on both is charging very much more than one charging the
 * ceiling on either.
 */
export const DEFAULT_FEE_REFERENCES: readonly FeeReference[] = [
  {
    fundType: 'PENSION',
    capOnAccumulationBasisPoints: 50,
    capOnDepositBasisPoints: 600,
    typicalOnAccumulationBasisPoints: 20,
    typicalOnDepositBasisPoints: 150,
    asOf: localDate(2026, 1, 1),
    source: 'רשות שוק ההון — ceiling; typical is what the default-fund tenders advertise',
  },
  {
    fundType: 'STUDY_FUND',
    capOnAccumulationBasisPoints: 105,
    capOnDepositBasisPoints: 400,
    typicalOnAccumulationBasisPoints: 60,
    typicalOnDepositBasisPoints: 0,
    asOf: localDate(2026, 1, 1),
    source: 'רשות שוק ההון — ceiling; a deposit fee on a study fund is uncommon',
  },
  {
    fundType: 'PROVIDENT',
    capOnAccumulationBasisPoints: 105,
    capOnDepositBasisPoints: 400,
    typicalOnAccumulationBasisPoints: 60,
    typicalOnDepositBasisPoints: 0,
    asOf: localDate(2026, 1, 1),
    source: 'רשות שוק ההון — ceiling',
  },
  {
    fundType: 'MANAGERS_INSURANCE',
    capOnAccumulationBasisPoints: 105,
    capOnDepositBasisPoints: 400,
    typicalOnAccumulationBasisPoints: 80,
    typicalOnDepositBasisPoints: 200,
    asOf: localDate(2026, 1, 1),
    source: 'רשות שוק ההון — ceiling for policies sold from 2013',
  },
  {
    fundType: 'PROVIDENT_FOR_INVESTMENT',
    capOnAccumulationBasisPoints: 105,
    capOnDepositBasisPoints: 400,
    typicalOnAccumulationBasisPoints: 70,
    typicalOnDepositBasisPoints: 0,
    asOf: localDate(2026, 1, 1),
    source: 'רשות שוק ההון — ceiling',
  },
]
