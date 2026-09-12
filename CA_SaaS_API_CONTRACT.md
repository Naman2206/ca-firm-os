# CA Firm OS SaaS API Contract

The static dashboard is a browser client. Production authentication, tenant isolation, file uploads, and billing must run behind this API.

## Authentication

`POST /auth/login`

```json
{ "email": "admin@firm.com", "password": "server-verified-password" }
```

Response:

```json
{
  "access_token": "short-lived-jwt",
  "user": { "id": "uuid", "email": "admin@firm.com", "tenant_name": "Sharma & Associates" }
}
```

Passwords must be hashed by the API with Argon2id or bcrypt. Never store them in HTML, localStorage, Google Sheets, or n8n execution data.

`POST /auth/refresh` rotates a refresh token. `POST /auth/logout` revokes the session.

## Tenant dashboard

`GET /dashboard`

Requires `Authorization: Bearer <access_token>` and returns the same read model used by `CA_Dashboard_API_n8n_workflow.json`, scoped from the verified token tenant:

```json
{
  "tenant": { "id": "uuid", "name": "Sharma & Associates", "plan": "professional" },
  "clients": { "total": 0, "rows": [] },
  "deadlines": { "pending": 0, "urgent": 0, "rows": [] },
  "documents": { "pending": 0, "rows": [] },
  "leads": { "active": 0, "rows": [] },
  "invoices": { "collected": "₹0.0L", "pending": "₹0.0L", "overdueClients": 0, "rows": [] },
  "tasks": [],
  "reports": { "complianceRate": 0, "automationHours": 0 }
}
```

## Customer file storage

`POST /customers/:customer_id/files/upload-url`

Returns a short-lived signed upload URL and server-generated storage key. The API must verify that the customer belongs to the token tenant.

```json
{ "file_name": "gst-return.pdf", "mime_type": "application/pdf", "fiscal_year": "2026-27", "document_type": "GST Return" }
```

`GET /customers/:customer_id/files` lists metadata only. `GET /files/:file_id/download-url` returns a short-lived signed download URL. Store bytes in S3, Supabase Storage, or GCS; store metadata in `customer_files` from `CA_SaaS_DATABASE_SCHEMA.sql`.

For Azure, store file bytes in a private Azure Blob Storage container and store only metadata in `customer_files` from `CA_SaaS_DATABASE_SCHEMA.sql`. The API should generate short-lived SAS URLs for upload and download. Do not expose storage account keys in the browser, dashboard HTML, n8n workflow exports, or Google Sheets.

Storage key format:

```text
tenant_id/customer_id/fiscal_year/random_uuid/original_file_name
```

## Billing and monetization

`POST /billing/checkout` creates a Stripe/Razorpay checkout session.

`POST /billing/webhook` verifies the provider signature and updates `subscriptions`.

`GET /billing/portal` returns a provider billing-portal URL.

Recommended plans:

- Starter: 25 customers, 5 GB file storage, 2 admin users
- Professional: 250 customers, 100 GB file storage, 10 admin users, WhatsApp/AI automations
- Enterprise: custom customer, storage, seats, and workflow limits

Record billable actions in `usage_events`: file bytes, active customers, messages, AI requests, and workflow executions.

## n8n boundary

n8n should remain the automation worker for WhatsApp, email, reminders, document processing, and payment events. It should call the Platform API with a service credential and must receive `tenant_id` from trusted server context, never from an unverified browser body.

For Azure-backed production, n8n should call Platform API endpoints instead of writing directly to Google Sheets/Drive. The Platform API writes PostgreSQL records and returns Azure Blob SAS URLs when files need to be uploaded or downloaded.
