# Frontend Source Status

**The customer, driver, merchant and admin frontend source files are MISSING from this recovery.**

| App | Path | Contents | Missing |
|---|---|---|---|
| Customer | `apps/customer/` | `README.md` placeholder only | all source, `package.json`, build and test setup |
| Driver | `apps/driver/` | `README.md` placeholder only | all source, `package.json`, build and test setup |
| Merchant | `apps/merchant/` | `README.md` placeholder only | all source, `package.json`, build and test setup |
| Admin | `apps/admin/` | `README.md` placeholder only | all source, `package.json`, build and test setup |

- The placeholders say only: "Frontend shell … Connect this app to the shared MULTIGO API under /api."
- The 87-file V45 export used for the restoration contained no frontend source, so none was lost during restoration.
- Not part of the root npm workspaces build and not covered by CI.
- No replacement applications have been generated. Restoring them requires the original frontend archive, or a separately approved rebuild against the existing `/api` backend.

## Search for the original source (performed)

Searched, with no frontend source found:
- All 36 commits reachable from every fetched ref, checking every tracked path for `apps/**` files and for any `.tsx/.jsx/.vue/.svelte/.html/.css/.scss`, `vite.config*`, `next.config*` or `index.html`: only the four `apps/*/README.md` files exist.
- All remote branches: `main` (1 file), `recovery-v45-api-perimeter` (9 files; only `apps/admin/README.md` under `apps/`), `copilot/fix-typo-in-documentation`, `copilot/inspect-existing-repository`, `copilot/konekte-sou-signature-gpg`, and `recovery/v45-source-restore`.
- Pull requests: only #2 (documentation typo).
- The local filesystem: no V45 ZIP or export file is present.

Exactly missing: every frontend source file for the four apps (components, pages, routing, API client code, styles, assets, `package.json`, lockfile, build and test configuration). The exact original file list is unknown without the original frontend archive.
