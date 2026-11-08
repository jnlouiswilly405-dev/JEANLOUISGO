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
