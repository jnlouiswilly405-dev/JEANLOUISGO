# MULTIGO Final QA Gate

Run these suites against a real PostgreSQL-backed environment:

1. Authentication/RBAC
2. Merchant/catalog
3. Order lifecycle
4. Payment/idempotency
5. Webhooks/refunds
6. Driver dispatch
7. Tracking/delivery
8. Notifications/realtime
9. Chat
10. Reviews/promos
11. Driver earnings/merchant settlement
12. Admin/audit
13. End-to-end customer → merchant → driver → settlement flow

GO criteria:
- zero critical/blocking failures
- payment/refund reconciliation passes
- order state transitions are valid
- audit events are generated for privileged actions
- database backup/restore is verified
- production configuration is reviewed
