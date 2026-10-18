# Fixtures

- `synthetic/` — hand-made statement files that look like the real thing but contain no real
  data. These are committed, and are what the public test suite runs against.
- `real/` — your own downloaded statements, for local testing.
  **Gitignored. Never commit these.**

Fixtures should cover file *shapes*, not providers: separate debit/credit columns, a
multi-section file, trailing-minus amounts, two-digit years, a header on row 9, and Hebrew
merchant names containing digits (the case that breaks bidi rendering).
