JEANLOUISGO V45 — SAFE SOURCE RESTORATION PACKAGE

This package is designed to restore missing backend source and PostgreSQL CI files
without changing main or overwriting the current recovery-v45-api-perimeter branch's
README, RESTORATION_STATUS.md, or existing package configuration.

1. Extract this ZIP on a computer with Git installed.
2. Authenticate Git to the GitHub repository.
3. Open a terminal in the extracted folder and run RESTORE_TO_GITHUB.sh.
4. The script clones JEANLOUISGO, creates recovery/v45-source-restore FROM
   origin/recovery-v45-api-perimeter, adds only files that are missing, commits,
   and pushes that new branch.
5. Review the new branch and run GitHub Actions. Do not merge or deploy unless
   PostgreSQL migrations, backend build, and tests pass.

Safety limits:
- main is not modified.
- recovery-v45-api-perimeter is not modified.
- Existing files on the base branch are not overwritten; the script adds missing files.
- Customer, driver, merchant, and admin frontend source is still absent (README placeholders only).
- Stripe adapter is still a stub. Keep live payments disabled.
- Static QA passed. npm install/build/tests and PostgreSQL CI remain unverified.
