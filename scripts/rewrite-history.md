# The history rewrite — runbook

Run once, before the repository goes public (M43 U8; the act is yours, D-430).
`rewrite-history.mjs` does the rewrite on a fresh clone and then proves it; this is the order
around it. It was rehearsed on a scratch clone on 2026-10-09 and every check passed: 627 commits
kept, one identity left, no denylist term in any object, message, path or `git log --all -p`,
the tree at HEAD identical, 4,454 tests and the privacy test green.

**It was run for real on 2026-10-15** (712 commits, one identity, zero hits, the suite green) and the result
pushed to the private `kfireliyahu/emerald-emd`. One check printed FAIL that day for a stale reason: it expected the
privacy test to report exactly two passing tests and it had grown a third; the script now accepts any count. The
working copy was not cloned afresh (step 7): a process held `.git` open, so its remote was repointed, the new
history fetched, and `main` and `m1` moved onto it, which leaves the old objects inside `.git` until step 8.

The script holds neither the old address nor the terms. It reads the identities from the clone's
history and the terms from `~/.emerald/denylist.txt` (or `$EMERALD_DENYLIST`), writes the mailmap
and the expressions to a temporary directory it deletes, and prints counts, hashes and paths only.

## 1. Stop every session

Close every Claude Code session, the driver and the app, so nothing writes `docs/memory.emd`.
Commit and push the working copy; `git status` must be clean.

## 2. Have git-filter-repo

`git filter-repo --version` should print a version (rehearsed with `a40bce548d2c` on git 2.24.1).
If it does not: `pip install git-filter-repo`. To keep it out of your Python, use a venv instead
and point the script at it:

```
python -m venv ~/filter-repo-venv
~/filter-repo-venv/Scripts/pip install git-filter-repo      # macOS / Linux: .../bin/pip
# then add  --filter-repo ~/filter-repo-venv/Scripts/git-filter-repo.exe  (or .../bin/git-filter-repo)
```

## 3. Refresh the backup

`~/.emerald/emerald-pre-rewrite.git` is a mirror from 2026-10-05, older than the last commits:

```
git -C ~/.emerald/emerald-pre-rewrite.git fetch --prune
```

## 4. Clone fresh, outside the working copy

```
git clone --no-local F:/projects/financial-companion F:/rewrite/emerald
```

`core.autocrlf` no longer matters: `.gitattributes` checks every text file out with LF whatever it
says (M43 U9), so the tour tests that failed on a CRLF checkout pass on any clone.

## 5. Dry run, then run

```
node F:/projects/financial-companion/scripts/rewrite-history.mjs F:/rewrite/emerald
node F:/projects/financial-companion/scripts/rewrite-history.mjs F:/rewrite/emerald --run
```

The dry run changes nothing and shows the counts before. `--run` takes about four minutes (one
to rewrite, the rest `npm ci` and the full suite in the clone) and must end with **All checks
passed**. Any `FAIL`: do not push; delete `F:/rewrite/emerald` and start again from step 4.

It refuses the working copy, a clone that is not fresh, and anything with a remote at
`emerald-emd`. Running it twice on the same clone is refused too: filter-repo removed `origin`.

## 6. Create the empty repository and push

Create `kfireliyahu/emerald-emd` on GitHub **empty** — no README, licence or `.gitignore`. Then:

```
cd F:/rewrite/emerald
git remote add origin https://github.com/kfireliyahu/emerald-emd.git
git push -u origin main
git push origin --tags        # the one tag, m1
```

## 7. Work from the new history

The working copy still holds the old history and points at the old repository. Move it aside,
clone the new one into the same path, and copy back what git ignores that you keep (`git status
--ignored` in the old one lists it: `fixtures/real/`, `docs/.obsidian/`, editor folders). Then
`npm ci`.

**Set the identity in the new clone before the first commit** — your global `user.email` is still
the old address, and one commit with it would put it back:

```
git config user.name  "Kfir Raphael Eliyahu"
git config user.email me@kfireliyahu.com
```

## 8. Remove what still holds the old history

Delete, or move to offline storage: `~/.emerald/emerald-pre-rewrite.git`, `F:/rewrite/emerald`,
and the old working copy you moved aside. The old private repository on GitHub holds it too;
archive or delete it when you no longer want it.
