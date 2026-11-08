# JEANLOUISGO CI runner hardening — v39

## Changes

- Added explicit least-privilege workflow permissions: `contents: read` only.
- Added per-ref concurrency grouping and cancellation of superseded runs to avoid wasting runner time.
- Added a 25-minute job timeout so a stalled dependency install or test cannot consume an unbounded hosted-runner session.
- Retained PostgreSQL 16 service health checks, explicit `postgresql-client` installation, schema bootstrap, ordered migrations, static QA, backend build, and backend tests.

## Validation

- `bash tests/final/static-qa.sh`: PASS in the recovery workspace.
- GitHub-hosted workflow execution: NOT RUN; the connected GitHub integration currently returns HTTP 403 for branch/ref writes.
- PostgreSQL integration and TypeScript/Vitest results: pending hosted CI execution.

## Safety

This change does not modify `main`, enable live payments, or change financial settlement policy. It only hardens CI execution controls.
