# JEANLOUISGO v1.1.1 — GitHub recovery upload guide (v38)

This guide is the fallback while the connected GitHub integration returns HTTP 403 for Git ref writes. It does not change `main` and does not require sharing a password or personal access token in chat.

## Target

- Repository: `jnlouiswilly405-dev/JEANLOUISGO`
- Base branch: `main`
- Recovery branch: `recovery/v38-upload`
- CI workflow: `.github/workflows/ci-postgres.yml`

## GitHub Desktop (recommended on a computer)

1. Download and extract the recovery ZIP locally.
2. In GitHub Desktop, clone `https://github.com/jnlouiswilly405-dev/JEANLOUISGO`.
3. Select **Current Branch → New Branch**, name it `recovery/v38-upload`, and create it from `main`.
4. Copy the *contents* of the extracted `jlgo_v3_check` folder into the cloned repository root. Do not create an extra nested `jlgo_v3_check` folder in the repository.
5. Review the changed-file list. Confirm that `.github/workflows/ci-postgres.yml`, `backend/`, `database/`, `tests/`, `docs/`, `package.json`, and `RESTORATION_STATUS.md` are included.
6. Commit with message `Restore JEANLOUISGO v1.1.1 recovery source and PostgreSQL CI`.
7. Select **Push origin**. This pushes only the recovery branch.
8. Open the repository's **Actions** tab and inspect the `JEANLOUISGO CI — PostgreSQL` run. Do not merge into `main` until the workflow passes and the remaining release gates are reviewed.

## Git command-line alternative

Run these commands from a terminal after downloading and extracting the ZIP. Replace `/path/to/extracted/jlgo_v3_check` with the actual extracted folder path.

```bash
git clone https://github.com/jnlouiswilly405-dev/JEANLOUISGO.git
cd JEANLOUISGO
git switch -c recovery/v38-upload
cp -a /path/to/extracted/jlgo_v3_check/. .
git status --short
# Review the file list before committing.
git add .
git commit -m "Restore JEANLOUISGO v1.1.1 recovery source and PostgreSQL CI"
git push -u origin recovery/v38-upload
```

On Windows PowerShell, replace the `cp` command with:

```powershell
Copy-Item -Path 'C:\path\to\jlgo_v3_check\*' -Destination '.' -Recurse -Force
```

## Safety and release gates

- Do not force-push and do not push this recovery set directly to `main`.
- Never paste GitHub passwords, tokens, or payment secrets into chat or commit them to the repository.
- The CI workflow installs Node.js 22 and PostgreSQL client, starts PostgreSQL 16, applies `database/schema.sql` and migrations 006–017, runs static QA, builds the backend, and runs Vitest.
- A passing CI run is necessary but not sufficient for launch. Stripe live payments remain disabled; the payment release audit lists outstanding processor/webhook/reconciliation work. The four app directories currently contain README placeholders rather than finished customer/driver/merchant/admin frontends.
- If the push is rejected, check repository write access and branch protection in GitHub. Do not bypass branch protections.
