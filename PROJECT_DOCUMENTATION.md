# Mehtas CA Firm OS

## 1. Project Overview

Mehtas CA Firm OS is a Chartered Accountant practice-management and automation platform. It combines:

- Admin dashboard for clients, leads, tasks, compliance, documents, invoices, and reports
- Client portal for submitting personal/business details and documents
- n8n automation for WhatsApp, email, leads, document intake, compliance reminders, invoices, and payments
- OpenAI support assistant for Indian tax and compliance questions
- Google Sheets as the initial operational database
- Google Drive as the initial document storage provider
- PostgreSQL/Supabase-ready multi-tenant SaaS schema for future monetization
- Azure-ready migration path for PostgreSQL database hosting and Blob Storage document storage

The current project is suitable for local testing. Production deployment requires a hosted API, hosted storage, real authentication, domain name, HTTPS, and configured third-party credentials.

## 2. Workspace Files

### Main dashboard

`ca-crm (1).html`

Single-page admin dashboard containing:

- Dashboard summary
- AI Support Agent
- Documents
- Compliance
- Leads
- Invoices
- Clients
- Tasks
- Reports
- Settings
- Dark mode
- Demo-local storage
- n8n dashboard API integration
- Client detail workspace
- Client document download controls

### Client portal

`client-portal.html`

Client-facing form for:

- Name/business name
- Phone/WhatsApp
- Email
- PAN
- GSTIN
- Service required
- Additional details
- Document upload

The portal supports demo-local storage and live n8n submission.

### Existing automation workflow

`CA_Firm_Automation_n8n_workflow.json`

Large n8n workflow containing approximately 152 nodes and the following automation branches:

1. WhatsApp incoming message router
2. Website lead intake
3. Gmail support and lead intake
4. Document request workflow
5. Payment confirmation workflow
6. Compliance deadline reminders
7. Document follow-up reminders
8. Lead follow-up reminders
9. Invoice follow-up reminders
10. Shared error logging and Telegram alerts

### Dashboard API workflow

`CA_Dashboard_API_n8n_workflow.json`

GET webhook that reads operational Google Sheets and returns one dashboard read model containing:

- Clients
- Compliance rows
- Documents
- Leads
- Invoices
- Derived tasks
- Report metrics

Webhook path:

```text
/webhook/ca-dashboard
```

### Client portal workflow

`CA_Client_Portal_n8n_workflow.json`

Receives client details and multipart document uploads, validates them, stores the document in Google Drive, and appends the submission to Google Sheets.

Webhook path:

```text
/webhook/client-document-upload
```

### OpenAI support workflow

`CA_OpenAI_Support_Chat_n8n_workflow.json`

Receives a client support message and client context, sends it to an OpenAI Chat Model, and returns a JSON reply.

Webhook path:

```text
/webhook/support-chat
```

### SaaS database schema

`CA_SaaS_DATABASE_SCHEMA.sql`

PostgreSQL/Supabase-ready schema containing:

- tenants
- admin_users
- customers
- customer_files
- subscriptions
- usage_events
- audit_logs
- Tenant isolation indexes and Row Level Security policies

### SaaS API contract

`CA_SaaS_API_CONTRACT.md`

Defines production endpoints for authentication, dashboard reads, signed file upload/download, billing, usage tracking, and n8n integration.

### Azure migration guide

`AZURE_MIGRATION_GUIDE.md`

Defines the Azure deployment path using Azure Database for PostgreSQL Flexible Server, private Azure Blob Storage, short-lived SAS upload/download URLs, and a Platform API boundary.

## 3. System Architecture

```text
Admin browser
  |
  | dashboard API and support requests
  v
n8n / Platform API
  |
  +--> Google Sheets operational data
  +--> Google Drive document storage
  +--> WhatsApp Cloud API
  +--> Gmail
  +--> Telegram partner alerts
  +--> OpenAI support assistant

Client browser
  |
  | client details + document upload
  v
Client Portal webhook in n8n
  |
  +--> Google Drive
  +--> Client_Portal_Submissions sheet
  +--> Future PostgreSQL customer_files table
```

## 4. Local Run Instructions

### Start the dashboard and portal server

From the workspace directory:

```powershell
python -m http.server 5500
```

Dashboard:

```text
http://localhost:5500/ca-crm%20(1).html
```

Client portal:

```text
http://localhost:5500/client-portal.html
```

### Start n8n with Docker

Docker Desktop must be running.

```powershell
docker run -d --name ca-n8n -p 5678:5678 -v ca_n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n
```

If the container already exists:

```powershell
docker start ca-n8n
```

n8n editor:

```text
http://localhost:5678
```

Check status:

```powershell
docker ps --filter "name=ca-n8n"
```

View logs:

```powershell
docker logs --tail 50 ca-n8n
```

## 5. n8n Setup

### Import workflows

In n8n, import:

- `CA_Firm_Automation_n8n_workflow.json`
- `CA_Dashboard_API_n8n_workflow.json`
- `CA_Client_Portal_n8n_workflow.json`
- `CA_OpenAI_Support_Chat_n8n_workflow.json`

The client portal and OpenAI workflows can also be imported into the local container with:

```powershell
docker cp .\CA_Client_Portal_n8n_workflow.json ca-n8n:/tmp/CA_Client_Portal_n8n_workflow.json
docker exec ca-n8n n8n import:workflow --input=/tmp/CA_Client_Portal_n8n_workflow.json

docker cp .\CA_OpenAI_Support_Chat_n8n_workflow.json ca-n8n:/tmp/CA_OpenAI_Support_Chat_n8n_workflow.json
docker exec ca-n8n n8n import:workflow --input=/tmp/CA_OpenAI_Support_Chat_n8n_workflow.json
```

### Activate workflows

Production webhooks only work when the workflow is active.

Activate these workflows in n8n:

- CA Firm Automation
- CA Dashboard API
- CA Client Portal - Document Intake
- CA OpenAI Client Support Chat

The OpenAI workflow requires a valid OpenAI credential before testing.

## 6. Required Credentials

Create credentials inside n8n. Never put these values in HTML, JSON exports, Google Sheets, or chat.

### Google Sheets

Credential name used by the workflows:

```text
Google Sheets - CA Firm
```

Required for operational tabs and dashboard reads.

### Google Drive

Credential name:

```text
Google Drive - CA Firm
```

Required for client document storage.

### OpenAI

Credential name:

```text
OpenAI API - Mehtas
```

Select this credential on the OpenAI Chat Model node. The OpenAI account must have available credits. A 429 response with `no credits remaining` means the OpenAI billing account needs credits.

### WhatsApp

Requires Meta WhatsApp Cloud API credentials and phone number ID.

### Gmail

Requires Gmail OAuth credentials.

### Telegram

Requires bot token and partner chat ID for alerts.

## 7. Google Sheets Structure

The existing workflows expect these tabs:

```text
Clients
Documents_Tracker
Compliance_Calendar
Leads
Invoices
Query_Log
Error_Log
Client_Portal_Submissions
```

### Clients

Recommended headers:

```text
client_id
name
phone
email
pan
gstin
client_type
services
status
created_at
updated_at
```

### Documents_Tracker

Recommended headers:

```text
doc_id
client_id
client_name
phone
email
compliance_type
document_name
requested_date
received_date
status
followup_count
```

### Compliance_Calendar

Recommended headers:

```text
compliance_id
client_id
client_name
phone
email
compliance_type
due_date
status
reminder_count
last_reminder_date
```

### Leads

Recommended headers:

```text
lead_id
name
phone
email
source
requirement
business_type
urgency
status
followup_date
followup_count
created_at
```

### Invoices

Recommended headers:

```text
invoice_id
client_id
client_name
phone
email
service
amount
currency
due_date
status
reminder_count
last_reminder_date
escalated
```

### Client_Portal_Submissions

Recommended headers:

```text
client_name
phone
email
pan
gstin
service
message
file_name
file_size
received_at
status
```

## 8. Client Portal Workflow

### Local portal

```text
http://localhost:5500/client-portal.html
```

The local portal submits to:

```text
http://localhost:5678/webhook/client-document-upload
```

A local browser fallback saves test records in:

```text
localStorage key: ca-client-portal-submissions
IndexedDB database: mehtas-client-files
```

This is only for testing in the same browser profile. It is not shared with other computers.

### Production portal

The portal must be hosted on a public HTTPS domain, for example:

```text
https://portal.yourdomain.com/client-portal.html
```

n8n must also be publicly reachable through HTTPS, or the portal must call a production Platform API.

Do not send clients a localhost URL.

## 9. Dashboard Data Flow

The dashboard stores the n8n dashboard API URL in browser local storage under:

```text
ca-firm-n8n-dashboard-url
```

The API should return:

```json
{
  "clients": { "total": 0, "rows": [] },
  "deadlines": { "pending": 0, "urgent": 0, "rows": [] },
  "documents": { "pending": 0, "rows": [] },
  "leads": { "active": 0, "rows": [] },
  "invoices": { "collected": "₹0.0L", "pending": "₹0.0L", "overdueClients": 0, "rows": [] },
  "tasks": [],
  "reports": { "complianceRate": 0, "automationHours": 0 }
}
```

The dashboard can use demo-local records when n8n is unavailable, but those records are browser-specific.

## 10. OpenAI Support Flow

The dashboard sends this request to n8n:

```text
POST http://localhost:5678/webhook/support-chat
```

Request example:

```json
{
  "client_id": "CLIENT-001",
  "client_name": "Example Client",
  "message": "What documents are required for GST filing?",
  "context": {
    "phone": "9876543210",
    "email": "client@example.com",
    "gstin": "TESTGSTIN",
    "pan": "ABCDE1234F",
    "documents": [],
    "compliance": [],
    "invoices": []
  }
}
```

Expected response:

```json
{
  "reply": "OpenAI-generated support reply"
}
```

If the endpoint returns 404, the workflow is not active. If it returns 500 and n8n logs show `429 no credits remaining`, add credits to the OpenAI account.

## 11. Indian Tax Assistant Policy

The OpenAI agent is configured for:

- GST and GST Rules
- Income Tax and ITR
- TDS/TCS
- Advance tax
- Tax audits
- Companies Act and ROC/MCA
- Routine bookkeeping

The agent must:

- Ask for the financial year and missing facts
- Avoid invented rates, deadlines, sections, or notifications
- Mention an official source or verification line where available
- Escalate notices, appeals, penalties, disputes, tax planning, foreign income, crypto, transfer pricing, and other high-risk matters
- Never request passwords, OTPs, card details, or private API keys
- Use the secure portal for document submission

The agent is an assistant, not a replacement for a qualified CA or legal opinion.

## 12. SaaS and Monetization Architecture

The project includes a scalable schema for future multi-firm SaaS:

- Each firm is a `tenant`
- Each admin belongs to one tenant
- Each customer belongs to one tenant
- Each customer file belongs to one tenant and customer
- Subscriptions belong to tenants
- Usage events measure billable actions
- Audit logs record sensitive operations
- PostgreSQL Row Level Security prevents cross-tenant access

Suggested plans:

### Starter

- 25 customers
- 5 GB storage
- 2 admin users
- Basic reminders

### Professional

- 250 customers
- 100 GB storage
- 10 admin users
- WhatsApp, email, AI support, and automation

### Enterprise

- Custom customers and storage
- Multiple teams and roles
- Custom workflows
- Priority support

Recommended billing providers:

- Stripe
- Razorpay

Use signed URLs for file uploads/downloads. Store file metadata in PostgreSQL and file bytes in Azure Blob Storage, S3, Supabase Storage, or Google Cloud Storage.

## 13. Security Requirements

Before production:

- Use HTTPS everywhere
- Replace demo authentication with server-side authentication
- Hash passwords with Argon2id or bcrypt
- Use short-lived access tokens and refresh tokens
- Never trust `tenant_id` from browser input
- Derive tenant ID from the verified token
- Validate all uploaded file types and sizes server-side
- Scan uploaded files for malware
- Use signed upload/download URLs
- Keep Google, OpenAI, WhatsApp, Gmail, and Telegram credentials in secret stores
- Add rate limits to login, uploads, and support requests
- Add audit logging for document access
- Restrict CORS to known production domains instead of `*`
- Avoid storing PAN and GSTIN in unprotected browser localStorage in production

## 14. Testing Checklist

### Dashboard

- Open the dashboard
- Use Preview demo workspace
- Verify Clients, Documents, Leads, Tasks, Reports
- Add a demo client
- Open the client detail view
- Upload a demo document
- Download the demo document
- Toggle dark mode

### Client portal

- Fill client details
- Choose service
- Upload a file under 10 MB
- Submit
- Verify the success message
- Return to dashboard
- Open Documents
- Confirm the document and Download button

### n8n

- Confirm container is running
- Confirm workflow is active
- Test `/webhook/client-document-upload` with POST multipart form data
- Test `/webhook/support-chat` with POST JSON
- Check executions for errors
- Check Google Sheets rows
- Check Google Drive files

### OpenAI

- Confirm OpenAI credential is attached
- Confirm account has available credits
- Send a GST question
- Verify response contains a helpful answer and source/verification guidance
- Test an uncertain/high-risk question and confirm escalation behavior

## 15. Known Limitations

- Local demo data is stored per browser and is not a real database.
- The current static dashboard is not production authentication.
- Localhost URLs cannot be sent to external clients.
- The OpenAI workflow requires an OpenAI account with available credits.
- Current n8n workflows use placeholders for Google IDs, credentials, WhatsApp IDs, Telegram IDs, and folder IDs.
- Google Sheets is suitable for testing but should be replaced or supplemented by PostgreSQL for multi-tenant production.
- Client portal local file storage uses browser IndexedDB and is not a secure cloud backup.
- Production file upload should use signed URLs and server-side metadata records.

## 16. Recommended Next Production Steps

1. Create a PostgreSQL/Supabase project.
2. Run `CA_SaaS_DATABASE_SCHEMA.sql`.
3. Build or deploy a secure Platform API.
4. Add admin authentication and tenant middleware.
5. Configure Azure Blob Storage, S3, Supabase Storage, or GCS.
6. Deploy n8n with HTTPS and persistent storage.
7. Configure Google, WhatsApp, Gmail, Telegram, and OpenAI credentials.
8. Replace placeholder IDs and URLs.
9. Deploy dashboard and portal to HTTPS hosting.
10. Restrict CORS and test each tenant boundary.
11. Add billing webhooks and plan limits.
12. Run a security review before accepting real client documents.
