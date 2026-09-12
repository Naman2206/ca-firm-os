# Azure Migration Guide

This project can move online with:

- Azure Database for PostgreSQL Flexible Server for the main database
- Azure Blob Storage for client document storage and retrieval
- A Platform API for authentication, tenant isolation, signed upload/download URLs, upload verification, and database writes
- n8n as the automation worker for WhatsApp, email, reminders, leads, and workflow forwarding
- Azure AI hosted model for the support assistant

Do not put Azure keys, database passwords, SAS signing keys, or client secrets in HTML, workflow JSON exports, Google Sheets, or chat.

## Target Architecture

```text
Admin dashboard / Client portal
  |
  | HTTPS
  v
Platform API
  |
  +--> Azure Database for PostgreSQL Flexible Server
  +--> Azure Blob Storage private container
  +--> Azure SAS upload/download URLs
  +--> Azure AI support endpoint
  +--> n8n service endpoints

n8n
  |
  +--> Platform API service credential
  +--> WhatsApp / Gmail / Telegram / OpenAI
```

## Azure Resources To Create

1. Resource group, for example `ca-firm-prod-rg`.
2. Azure Database for PostgreSQL Flexible Server.
3. Database, for example `ca_firm_os`.
4. Azure Storage Account.
5. Private Blob container, for example `client-documents`.
6. App host for the Platform API, such as Azure App Service, Azure Container Apps, or Azure Functions.
7. Static hosting for the dashboard and portal, such as Azure Static Web Apps or Azure Storage static website.

Microsoft's PostgreSQL Flexible Server requires encrypted TLS connections. Use a connection string with `sslmode=require` at minimum.

## Environment Variables For Platform API

```text
DATABASE_URL=postgres://<user>:<password>@<server>.postgres.database.azure.com:5432/ca_firm_os?sslmode=require
AZURE_STORAGE_ACCOUNT=<storage-account-name>
AZURE_STORAGE_CONTAINER=client-documents
AZURE_STORAGE_CONNECTION_STRING=<server-side-only-secret>
JWT_SECRET=<server-side-secret>
AZURE_AI_ENDPOINT=https://<azure-ai-resource>.openai.azure.com
AZURE_AI_DEPLOYMENT=<model-deployment-name>
N8N_SERVICE_TOKEN=<server-side-secret>
```

Prefer Managed Identity for production Azure access where possible. If using a storage connection string during early setup, keep it only on the server.

## Database Migration

1. Create the Azure PostgreSQL database.
2. Open the firewall only for trusted IPs/services.
3. Run the schema (including the dashboard's leads, invoices, and compliance tables):

```powershell
psql "host=<server>.postgres.database.azure.com port=5432 dbname=ca_firm_os user=<admin> password=<password> sslmode=require" -f .\CA_SaaS_DATABASE_SCHEMA.sql
```

4. Export current Google Sheets tabs as CSV:

```text
Clients
Documents_Tracker
Compliance_Calendar
Leads
Invoices
Client_Portal_Submissions
```

5. Import CSV data into the matching tenant-scoped Azure PostgreSQL tables:

```text
Clients -> customers
Documents_Tracker / Client_Portal_Submissions -> customer_files metadata
Invoices -> future invoice table or usage/audit metadata until invoice tables are added
Compliance_Calendar -> future compliance table or automation source sheet until table is added
Leads -> future leads table or CRM source sheet until table is added
```

The SaaS schema includes tenant, admin, customer, file, subscription, usage, audit, lead, invoice, and compliance tables. Import the corresponding Google Sheets rows before retiring Google Sheets.

## Blob Storage Migration

Use a private container. Store files with this key format:

```text
tenant_id/customer_id/fiscal_year/random_uuid/original_file_name
```

The dashboard upload flow now requests a short-lived SAS URL, uploads directly to the private Blob container, calls the API to verify the Blob and record its byte size, and then retrieves files through a short-lived download SAS URL.

For every uploaded file:

1. Upload the file bytes to Azure Blob Storage.
2. Insert a `customer_files` row with:

```text
storage_provider = azure_blob
storage_bucket = client-documents
storage_key = tenant_id/customer_id/fiscal_year/random_uuid/original_file_name
original_name = original filename
mime_type = detected MIME type
byte_size = file size
document_type = GST Return / PAN / Bank Statement / etc.
fiscal_year = 2026-27 / etc.
```

## Upload And Retrieval Flow

Uploads:

1. Browser asks Platform API: `POST /customers/:customer_id/files/upload-url`.
2. API verifies the admin/client belongs to the tenant.
3. API creates a short-lived Azure Blob SAS URL with write permission for one blob.
4. Browser uploads directly to Azure Blob Storage using `PUT`.
5. Browser calls `POST /files/:file_id/complete`; the API verifies the Blob exists and records its size in PostgreSQL.

Downloads:

1. Browser asks Platform API: `GET /files/:file_id/download-url`.
2. API verifies tenant access.
3. API creates a short-lived read-only Azure Blob SAS URL.
4. Browser opens/downloads the file from Azure Blob Storage.

## n8n Changes Needed

Current n8n workflows write to Google Sheets and Google Drive. For Azure production:

- Dashboard API should read from Platform API or PostgreSQL, not Google Sheets.
- Client portal intake should call Platform API and upload to Azure Blob, not Google Drive.
- Automation workflows should update Platform API endpoints for clients, documents, leads, invoices, and compliance records.
- Keep WhatsApp, Gmail, and Telegram in n8n.
- Route support chat to `POST /support/chat`; the Platform API calls Azure AI using Managed Identity.
- Keep tenant identity server-derived; never trust `tenant_id` from browser form fields.

## Frontend Settings

In the dashboard Settings screen:

```text
Dashboard API URL: https://<your-api-domain>/dashboard
Platform API URL: https://<your-api-domain>
```

The client portal should submit to the Platform API in production, or to an n8n webhook only if n8n is publicly hosted with HTTPS and forwards records into the Platform API.

## Security Checklist

- Enable HTTPS everywhere.
- Keep Blob containers private.
- Use short-lived SAS URLs.
- Restrict Storage CORS to your dashboard/portal domains.
- Use PostgreSQL TLS with `sslmode=require` or stronger certificate verification.
- Use server-side authentication and tenant middleware.
- Use Row Level Security policies from `CA_SaaS_DATABASE_SCHEMA.sql`.
- Add audit logs for every document upload/download.
- Validate file type and size server-side before creating upload URLs.
- Add malware scanning before marking sensitive files approved.
- Store secrets in Azure Key Vault or app service configuration, not files.

## Useful Official References

- Azure Database for PostgreSQL TLS: https://learn.microsoft.com/en-us/azure/postgresql/security/security-tls-how-to-connect
- Azure Database for PostgreSQL quickstart and connection string: https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/quickstart-create-server
- Azure Blob Storage JavaScript SDK and browser CORS notes: https://learn.microsoft.com/en-us/javascript/api/overview/azure/storage-blob-readme
- Azure browser upload with SAS pattern: https://learn.microsoft.com/en-us/azure/developer/javascript/tutorial/browser-file-upload-azure-storage-blob
- Azure Blob Storage static website hosting: https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-static-website
