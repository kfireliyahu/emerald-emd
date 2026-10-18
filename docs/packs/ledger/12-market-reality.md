---
type: notes
project: Emerald
---

# 12 — Market Reality

Written to answer "would other people use this?" honestly, and to record why the project is
scoped the way it is. Read it before ever deciding to build for anyone but yourself.

> **This analyses the first pack's market, not the product's** ([D-211](../../09-decision-log.md),
> 2026-09-15). Everything below is about Israeli personal finance and stays true of it. Under the
> engine proposal the competitive set changes: the nearest neighbours become **typed, relational
> spreadsheet-databases** (self-hosting, with a formula language) and, more pressingly, **a folder of
> markdown and a good model** — free, already working, and what this project actually ran (D-210). The delta
> over all three is the same three things — document ingestion with proof, provenance, and staleness
> — tabulated in [`engine.md`](../../engine.md#the-nearest-neighbours-named-honestly).
>
> **The conclusion below does not weaken.** *Build it for yourself* was reached a second time from
> the engine direction, because the audience is the person who already keeps this by hand — not the
> person who has never used a spreadsheet.

## The short version

**As a whole product: probably not.** The Israeli market has an established incumbent that
solves the hardest part — getting the data in — far better than file import ever can, because
it is licensed to connect directly to accounts.

**As three specific pieces: yes, and one of them is genuinely unserved.**

## What already exists

| What | Who | What it does well | Gap |
|---|---|---|---|
| Bank-connected budgeting | A bank-connected budgeting subscription (~₪45/month), 100k+ members globally, ISA-supervised | Automatic data, zero import friction, categorization, coaching | Retrospective. Weak on forward allocation. Doesn't touch pension. Cloud, subscription, requires account access. |
| Fund comparison | פנסיה נט (government), גמל נט and similar | Compare funds by fee and return | Compares *funds*, not *your* funds. No connection to your payslip. |
| Institution apps | Each fund manager's own app | Your balances at that institution | One institution only. No cross-fund view. Their incentive is retention, not fee transparency. |
| Spreadsheets | Everyone else | Total control | Rots. Manual. What this project is replacing. |

## The regulatory wall

"If it becomes popular there could be real connections" gets the sequencing backwards.
Direct account connection in Israel is not a popularity milestone — it is a **licensing**
milestone.

Israel's Financial Information Service Law took effect in June 2022 and requires financial
institutions to give licensed competitors automated access to customer data with consent. The
operative word is *licensed*: providing that service requires authorization from the Israel
Securities Authority, with the compliance, capital, audit, and security obligations that
implies. The bank-connected budgeting subscription above is ISA-supervised for exactly this reason.

Two realistic paths exist, and neither is a weekend upgrade:

1. **Get licensed.** A company-scale undertaking, not a side-project one.
2. **Build on a licensed aggregator** (several operate in this space). Removes the
   licensing burden but replaces it with B2B contracts, per-call costs, and a dependency that
   makes the app no longer free to run — which contradicts the local-first, no-backend design in
   [02 Architecture](../../02-architecture.md).

**Consequence for this project:** file import is not a temporary limitation on the way to
"real connections". It is the architecture. Design it as a permanent choice, and treat the
absence of a backend as a feature — no subscription, no credentials handed over, no data
leaving the device.

> **And the pricing follows from it** (D-124). Emerald is free: no subscription, no paid tier, no
> licence key. That is not modesty about the work — it is the only price consistent with having no
> backend. Charging monthly means running something to meter, bill and support, which is the exact
> dependency this section spent four paragraphs rejecting. Optional one-time support is a link in
> the README; it unlocks nothing, because nothing is locked.

## Where this project is genuinely differentiated

### 1. Pension deposit reconciliation — the real one

Nothing on the market cross-references **what the payslip says was deducted** against **what
the fund reports receiving**. Comparison sites compare funds. Institution apps show one
institution. The clearing house shows balances. None of them notice that your employer stopped
depositing eight months ago.

That is a specific, painful, well-documented problem with a clear moment of value: one screen
that says *"₪2,300 is unaccounted for."* It is the piece of this project most likely to matter
to someone other than you.

It is also, notably, **a smaller app than this one.** Payslip entry plus fund snapshots plus the
reconciliation — no ledger, no categories, no import pipeline. If any part of this project ever
becomes a *product*, it is probably that part, extracted — but note that "product" here means a
thing other people use, not a thing they are billed for. D-124 settled the price at zero for
Emerald; an extracted pension tool would be its own project making its own decision, and inheriting
nothing from this one except the code.

### 2. Forward-looking paycheck allocation

Most tools answer "where did it go". [F05 Paycheck Splitter](./f05-paycheck-splitter.md) answers "where should it go",
with fixed expenses subtracted and locked buckets. Less crowded, and it is the half of personal
finance that actually changes behavior.

### 3. Local-first as a stance

A real audience exists for "my financial data never leaves this device, and I pay nothing
monthly" — people who won't hand over bank credentials to a third party. It is a small
audience, and it is not a growth market. But it is real, and it costs nothing to serve, because
it is what the app is anyway.

**"I pay nothing monthly" is now literal** (D-124): free, unsigned builds for macOS and Windows,
handed out directly. The claim and the price are the same claim, and an app that charged for itself
would be arguing against its own pitch.

## Honest assessment of the audience

The person who will tolerate exporting a file and mapping its columns is already a spreadsheet
person. That is a narrow segment, and it does not widen — the mainstream user compares this to
an app that requires no import at all and stops there.

So: **build it for yourself.** Optimize every decision for your own use, not for a hypothetical
user. That is not a consolation. It is a real advantage — it means you can skip onboarding
polish, ignore edge cases you don't have, and use yourself as the entire user research program.
The features that survive contact with your own real data are the only ones worth generalizing.

If it turns out others want it, the extraction path is clear and it starts with the pension
piece.

## What would change this assessment

- The incumbent raising prices, shutting down, or exiting Israel.
- A licensed aggregator offering affordable per-user API access to individual developers.
- Regulatory pressure forcing pension fee and deposit transparency, making reconciliation a
  mainstream expectation rather than a niche worry.
- The pension reconciliation feature proving to catch a real problem in your own data. If it
  finds money missing from your own funds, it will find it in other people's.

## Sources

- [Top 5 Personal Finance Apps in Israel, Q3 2025 — Sensor Tower](https://sensortower.com/blog/2025-q3-unified-top-5-personal%20finance%20budgeting%20and%20planning-units-il-63e363f0e1714cfff1979caa)
- [Open Banking in Israel — Open Banking Tracker](https://www.openbankingtracker.com/country/israel)
- [Open Banking is Taking Off in Israel — Legalink](https://www.legalink.net/en/publications/newsletters/open-banking-is-taking-off-in-israel/3157/)
- [Bank of Israel — Open Banking standard regulation](https://kamakama.gov.il/en/communication-and-publications/press-releases/the-banking-supervision-department-is-leading-the-regulation-of-an-open-banking-standard-in-israel/)
- [פנסיה נט — Capital Market Authority](https://pensyanet.cma.gov.il/)
- [גמל נט — fund comparison](https://gemel-net.co.il/)

## Related

[F13 Pension and Hishtalmut](./f13-pension-and-hishtalmut.md) · [F05 Paycheck Splitter](./f05-paycheck-splitter.md)
