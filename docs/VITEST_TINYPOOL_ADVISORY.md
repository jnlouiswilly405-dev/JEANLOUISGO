# Vitest / Tinypool advisory investigation

Scope: dev dependencies only. `npm audit --omit=dev` reports 0 vulnerabilities; production dependencies are unaffected.
Nothing in the repository was changed; the experiment ran in an isolated scratch copy (`git archive` of `682189f`, deleted afterwards).

## Findings
- Installed: `vitest 3.2.7`, `vite 7.3.7`, `tinypool 1.1.1`, `@vitest/mocker 3.2.7`.
- `npm audit`: `tinypool <=2.1.1` (critical; prototype pollution leading to code execution, reachable only by running untrusted test code),
  `@vitest/mocker <=4.1.11` (moderate), and `vitest` itself as a dependent (critical). Total 3 (1 moderate, 2 critical).
- Fix offered by audit: `vitest@5.1.0` (semver-major).

## Scratch experiment (Node 22.23.4, `npm ci --ignore-scripts` then `npm i -D vitest@5.1.0 -w backend`)
| Check | Result |
|---|---|
| `npm audit` | 0 vulnerabilities |
| Resolved | vitest 5.1.0, @vitest/mocker 5.1.0, vite 8.3.6 (major bump from 7) |
| Type check (`lint`) / build | pass / pass |
| Unit tests | 68/68 pass |
| Integration tests (PostgreSQL 16) | 78/78 pass (on the `682189f` base) |
| Compatibility | vitest 5.1.0 needs Node `^22.12 || ^24 || >=26`; CI uses Node 22 (OK). Root `engines` says `>=20`, which would need raising to `>=22.12`. Lockfile gains ~12 packages. |

## Recommended safe upgrade plan (needs approval; not applied)
1. Separate branch `recovery/vitest-5-upgrade` from the current recovery tip; change only `backend/package.json` (`vitest` to `^5.1.0`), the lockfile and root `engines.node` to `>=22.12`.
2. Run on Node 22 with `npm ci`; build, lint, unit, PostgreSQL integration (twice), static QA and `npm audit` (expect 0).
3. Push and require green GitHub Actions; own commit; merge only with owner approval.
4. Interim mitigation, valid today: do not run untrusted code or third-party PRs through the test runner; the CI is triggered only for `main` and `recovery/**` pushes.
5. Rollback: revert the single commit.
