# JEANLOUISGO V45 — GitHub Source Restore

Repository: `https://github.com/jnlouiswilly405-dev/JEANLOUISGO`
Base branch: `recovery-v45-api-perimeter`
Target branch: `recovery/v45-source-restore`

## Recommended path
Use the included `RESTORE_TO_GITHUB.sh` from a computer with Git installed and a GitHub account that has write access.

1. Download and extract the complete V45 recovery ZIP.
2. Open a terminal in the extracted `JEANLOUISGO_V45_AUDITED` folder.
3. Run `bash RESTORE_TO_GITHUB.sh`.
4. The script clones the repository, checks that the base branch exists, creates the target branch from that base, copies only files that are missing, commits, and pushes the target branch.
5. Open the target branch in GitHub and inspect the changed files.
6. Open Actions and inspect `JEANLOUISGO CI — PostgreSQL`.

## GitHub Desktop alternative
1. Clone `jnlouiswilly405-dev/JEANLOUISGO`.
2. Fetch origin and switch to `recovery-v45-api-perimeter`.
3. Create a new branch named `recovery/v45-source-restore` from that branch.
4. Copy the contents of the archive's `jlgo_v3_check` folder into the repository root. Review all conflicts carefully; do not overwrite unrelated existing files blindly.
5. Commit and push only `recovery/v45-source-restore`.

## Safety
- Do not modify or force-push `main`.
- Do not paste passwords, personal access tokens, or payment secrets into ChatGPT.
- Do not merge until PostgreSQL migrations, TypeScript build, and Vitest pass.
- Stripe/live payments remain blocked until the official processor implementation and webhook signature verification are complete.
