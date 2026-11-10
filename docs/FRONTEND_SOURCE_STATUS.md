# Frontend Source Status

**The ORIGINAL customer, driver, merchant and admin frontend source files are STILL MISSING. They have NOT been recovered.**

Since the owner's approval, new apps have been **reconstructed** (new code, written against the existing backend API contracts). They were first developed on branch `recovery/v45-frontend-reconstruction` and are now included in `main`. They are not the original source, their design and UI language are unverified against the original, and no original file list is known.

| App | Path | Original source | Reconstruction (included in `main`) |
|---|---|---|---|
| Customer | `apps/customer/` | missing | React 19 + Vite + TS: browse, cart, order, order tracking, sandbox card payment (`pk_test_` only), order chat, notifications, reviews, promo codes |
| Driver | `apps/driver/` | missing | active deliveries, delivery progression, opt-in location sharing, read-only earnings, notifications, order chat |
| Merchant | `apps/merchant/` | missing | order status actions, menu and restaurant management, read-only settlements, notifications, order chat, merchant reviews (read-only) |
| Admin | `apps/admin/` | missing | health, financial summary, blocked outbox, unreferenced payments (read-only) and promotion create/deactivate (platform-funded by default) |
| Shared | `packages/api-client`, `packages/app-shell` | n/a | typed client and session/role gate |

- The original placeholders said only: "Frontend shell … Connect this app to the shared MULTIGO API under /api."
- The 87-file V45 export used for the restoration contained no frontend source, so none was lost during restoration.
- Reconstruction details, scope and gaps: `FRONTEND_RECOVERY_PLAN.md` (section 6).

## Search for the original source (performed)

Searched, with no frontend source found:
- All 36 commits reachable from every fetched ref, checking every tracked path for `apps/**` files and for any `.tsx/.jsx/.vue/.svelte/.html/.css/.scss`, `vite.config*`, `next.config*` or `index.html`: only the four `apps/*/README.md` files exist.
- All remote branches: `main` (1 file), `recovery-v45-api-perimeter` (9 files; only `apps/admin/README.md` under `apps/`), `copilot/fix-typo-in-documentation`, `copilot/inspect-existing-repository`, `copilot/konekte-sou-signature-gpg`, and `recovery/v45-source-restore`.
- Pull requests: only #2 (documentation typo).
- The local filesystem: no V45 ZIP or export file is present.

Re-run on 2026-11-08 after the Stripe and Vitest work: 41 commits across all refs, no tags, no stashes, and a filesystem search for archives or V45/JEANLOUISGO-named files outside the repository. Still no frontend source (no UI files, no `apps/*/package.json`, no archives). Reconstruction plan: `FRONTEND_RECOVERY_PLAN.md`.

Exactly missing: every frontend source file for the four apps (components, pages, routing, API client code, styles, assets, `package.json`, lockfile, build and test configuration). The exact original file list is unknown without the original frontend archive.
