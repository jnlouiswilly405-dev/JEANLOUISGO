jeanlouisgo Final QA Gate
Run these suites against a real PostgreSQL-backed environment:
Authentication/RBAC
Merchant/catalog
Order lifecycle
Payment/idempotency
Webhooks/refunds
Driver dispatch
Tracking/delivery
Notifications/realtime
Chat
Reviews/promos
Driver earnings/merchant settlement
Admin/audit
End-to-end customer → merchant → driver → settlement flow
GO criteria:
zero critical/blocking failures
payment/refund reconciliation passes
order state transitions are valid
audit events are generated for privileged actions
database backup/restore is verified
production configuration is reviewed