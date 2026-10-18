<!-- Written by src/parity.test.ts, never by hand: `npx vitest run src/parity.test.ts -u` rewrites it. -->

# Parity — what each half owes

Derived by [the parity audit](../src/parity.test.ts) on every test run (D-234, D-249, D-251), and a
copy that has gone stale fails the build. **Tools first, screens in M26**: a missing tool needs an
answer, a missing screen is only counted.

## Screen trails — M26's scope

What a conversation can do and no screen can. M26 closed with these left (D-297); the ledger's are M28's.

### The engine

- **Add a unit, or correct what one is worth.** `record_units` · `addUnit`, `correctUnit`
- **Put a column in the entry’s header line, or take it out.** `arrange_views` · `setEntryHeader`
- **Set what a roadmap folds and shows, what a ready list reads, a start-here question, or what finished is on the agenda.** `arrange_views` · `setViewSetting`

### The ledger — 3

- **categoryRepository** — `setCategoryFromAssistant`
- **merchantSuggestionRepository** — `clearMerchantSuggestions`, `noteMerchantSuggestions`

## Owed a tool

### The engine — each one answered

- **Move a bubble, or a pack’s folded group, on the connections canvas — or put them all back.** (refused by D-291) · `setGraphPlaces`, `clearGraphPlaces`

### The ledger — 65, a ratchet rather than a list to work through

A screen reaches these and no tool does, which the plugin's *Not here* has said since D-109. The
number may only fall. M25 rewrites what is under them, and M24's survey decides which the engine
has to be able to hold first. Of the ledger's 183 writes, 18 more
are only ever called by another write, and count with it.

- **accountRepository** — `deleteAccount`, `mergeAccounts`, `setAccountArchived`, `setAccountInstitution`
- **cardSettlementRepository** — `decideAllForCard`, `setSettlementDecision`
- **categoryOverrideRepository** — `correctCategories`, `correctCategory`, `undoCorrections`
- **categoryRuleRepository** — `deleteRule`, `reorderRules`, `setRuleEnabled`, `updateRule`
- **columnRoleRepository** — `addColumnRole`
- **debtRepository** — `confirmPayment`, `declineInstallmentGroup`, `deleteDebt`, `deletePayment`, `dismissAmbiguity`, `dismissPayment`, `promoteInstallmentGroup`, `resolveAmbiguity`, `setDebtClosed`, `setInstallmentOffers`, `setInstallmentThreshold`, `updateDebt`, `updatePayment`
- **documentTemplateRepository** — `correctTemplateField`, `deleteTemplate`, `nameDeductionRows`, `recordTemplateUse`, `renameTemplate`, `saveTemplate`
- **fixedExpenseRepository** — `endFixedExpense`
- **fundRepository** — `acknowledgeDepositGap`, `deleteFund`, `deleteSnapshot`, `setFundArchived`, `updateFund`, `updateSnapshot`
- **guideRepository** — `saveGuideProgress`
- **importMappingRepository** — `deleteMapping`, `duplicateMapping`, `renameMapping`, `setMappingAccount`
- **institutionRepository** — `createInstitution`
- **labelingQueueRepository** — `skipAll`
- **paycheckRepository** — `deletePaycheck`, `updatePaycheck`
- **reapplyRepository** — `undoReapply`
- **ruleSetRepository** — `forkBuiltIn`, `setBuiltInEnabled`
- **salaryRepository** — `setSalaryDecision`
- **savingsRepository** — `confirmHolding`, `deleteDeposit`, `deleteGoal`, `deleteHolding`, `deleteHoldingPlace`, `setGoalClosed`, `setHoldingArchived`, `setHoldingPlaceArchived`, `updateDeposit`, `updateHolding`, `updateHoldingPlace`
- **splitPlanRepository** — `reorderSplitBuckets`
