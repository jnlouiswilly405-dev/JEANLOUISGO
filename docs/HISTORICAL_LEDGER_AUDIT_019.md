# Pre-migration 019 historical ledger audit

Migration 019 creates a partial unique index allowing at most one platform-clearing
credit per order. It does not repair or delete history. Do not apply it to a
staging or production database until an authorized financial operator has
reviewed a database snapshot and signed off the findings. This procedure is
preparation only; no sensitive or production database was accessed for this
review.

## Authorization and handling

1. Obtain written authorization naming the database, operator, purpose, and
   read-only window. Use an existing approved read-only account; do not copy
   production credentials into a worktree, CI secret, issue, or report.
2. Take and verify the normal encrypted database backup before the audit.
   Prefer running on a protected restored snapshot. Restrict query output to
   the authorized operators; do not export customer, address, or payment
   instrument data.
3. Connect with `psql` and start a read-only transaction. Stop if the session
   cannot enforce read-only mode:

   ```sql
   BEGIN TRANSACTION READ ONLY;
   ```

4. Run only the aggregate and mismatch queries below. Save counts and
   redacted order identifiers in the approved audit record; never alter rows
   to make the migration pass.
5. End with `ROLLBACK;` and record the database snapshot identifier, schema
   version, operator, query timestamp, and checksum of the redacted report.

## Read-only queries

Duplicate clearing credits that will prevent the index from being created:

```sql
SELECT order_id, count(*) AS credit_count,
       sum(amount_cents) AS total_credit_cents,
       min(currency) AS min_currency, max(currency) AS max_currency
FROM ledger_entries
WHERE account_type = 'PLATFORM_CLEARING'
  AND direction = 'CREDIT'
  AND order_id IS NOT NULL
GROUP BY order_id
HAVING count(*) > 1
ORDER BY order_id;
```

Orders with multiple succeeded payments or a clearing credit count other than
one:

```sql
WITH succeeded AS (
  SELECT order_id, count(*) AS payment_count,
         sum(amount_cents) AS payment_total_cents
  FROM payments
  WHERE status = 'SUCCEEDED'
  GROUP BY order_id
),
credits AS (
  SELECT order_id, count(*) AS credit_count,
         sum(amount_cents) AS credit_total_cents,
         min(currency) AS min_currency, max(currency) AS max_currency
  FROM ledger_entries
  WHERE account_type = 'PLATFORM_CLEARING'
    AND direction = 'CREDIT'
    AND order_id IS NOT NULL
  GROUP BY order_id
)
SELECT o.id AS order_id, o.status, o.total_cents, o.currency,
       coalesce(s.payment_count, 0) AS payment_count,
       coalesce(s.payment_total_cents, 0) AS payment_total_cents,
       coalesce(c.credit_count, 0) AS credit_count,
       coalesce(c.credit_total_cents, 0) AS credit_total_cents,
       c.min_currency, c.max_currency
FROM orders o
LEFT JOIN succeeded s ON s.order_id = o.id
LEFT JOIN credits c ON c.order_id = o.id
WHERE coalesce(s.payment_count, 0) > 1
   OR (coalesce(s.payment_count, 0) > 0 AND coalesce(c.credit_count, 0) <> 1)
   OR (coalesce(c.credit_count, 0) > 0 AND coalesce(s.payment_count, 0) = 0)
   OR (coalesce(s.payment_count, 0) = 1 AND
       (s.payment_total_cents <> o.total_cents OR c.credit_total_cents <> o.total_cents))
   OR (coalesce(c.credit_count, 0) > 0 AND
       (c.min_currency <> o.currency OR c.max_currency <> o.currency))
ORDER BY o.id;
```

Also count all candidate rows and duplicates without returning identifiers:

```sql
SELECT count(*) AS candidate_order_count,
       count(*) FILTER (WHERE credit_count > 1) AS duplicate_order_count
FROM (
  SELECT order_id, count(*) AS credit_count
  FROM ledger_entries
  WHERE account_type = 'PLATFORM_CLEARING'
    AND direction = 'CREDIT'
    AND order_id IS NOT NULL
  GROUP BY order_id
) AS per_order;
```

## Decision gate

Any duplicate, amount/currency mismatch, multiple capture, credit without a
succeeded payment, or incomplete capture/ledger pair is a stop condition.
Reconcile against provider records with the finance owner; document the
resolution separately under the approved change process. Do not delete,
rewrite, or net ledger entries merely to make migration 019 succeed.

After review, take another verified backup and have the database owner approve
a maintenance window. Apply migration 019 only as a separate authorized
operation, then verify the index exists and run the post-migration duplicate
count query. This implementation task does not run that migration.
