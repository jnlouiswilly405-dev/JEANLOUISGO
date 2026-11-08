# Frontend source search and stack approval

## Search result: original frontend NOT RECOVERED
Searched: all remote branches, all commits (48), tags (0), releases (0), Actions artifacts (0), open PRs, the
owner's other repositories (`Multigo-`, the private restore repo, `jeanlouisgo.github.com`) and local disk.
No `.tsx/.jsx/.vue/.svelte/.html/.css`, bundler config, `apps/*/src`, `apps/*/package.json` or archive exists
in any ref. Only the four README placeholders under `apps/` exist. The original ZIP is also absent, so
byte-exact archive verification remains INCOMPLETE.

## Owner-approved stack (approval to document only)
React 19, Vite and TypeScript. Four separate applications (customer, driver, merchant, admin) with a shared
API client (`packages/api-client`). Rebuilding has NOT started and needs separate approval; see
`FRONTEND_RECOVERY_PLAN.md` and `FRONTEND_PHASE0_ANALYSIS.md` for the phases.

## Static QA review
Since `dbdf206`, `tests/final/static-qa.sh` lost 3 pins: one was re-pinned equivalently for the type fix
(`188f92e`), and two upsert-guard pins were replaced by stricter ones (`191501e`). Checks went from 99 to 100.
No meaningful safety check was lost.
