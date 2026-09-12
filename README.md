# CA Firm OS

CA Firm OS is a tenant-scoped practice-management system for chartered-accountancy firms. It provides an admin dashboard, a client portal, a Node.js API, Azure PostgreSQL persistence, private Azure Blob document storage, Azure AI support chat, and n8n automation workflows.

## Live deployment

- Admin portal: <https://green-glacier-06e044600.3.azurestaticapps.net/>
- Client portal: <https://witty-grass-0b260ac00.3.azurestaticapps.net/>
- API health: <https://app-ca-firm-os-prod-a6fc.azurewebsites.net/healthz>

The API and data services run in Azure Central India. The Static Web Apps run in East Asia because Static Web Apps are not available in Central India.

## Repository structure

| Path | Purpose |
| --- | --- |
| `ca-crm (1).html` | Admin dashboard |
| `client-portal.html` | Client-facing portal |
| `platform-api/` | Express API, authentication, database, Blob Storage, and Azure AI integration |
| `CA_SaaS_DATABASE_SCHEMA.sql` | PostgreSQL schema |
| `infra/` | Azure Bicep deployment templates |
| `*_n8n_workflow.json` | Importable n8n automation workflows |
| `portal-check.js` | Portal smoke-check script |

## Run locally

Requirements:

- Node.js 20 or later
- PostgreSQL with the schema applied
- Azure Storage account and private Blob container
- Azure AI deployment, or a configured Azure AI endpoint

Copy the configuration template and provide local values:

```powershell
Copy-Item .\platform-api\.env.example .\platform-api\.env
cd .\platform-api
npm ci
npm run check
npm start
```

Never commit `.env`. The example file contains placeholders only. Apply the database schema with the connection details in your local environment:

```powershell
node .\scripts\apply-schema.js
```

Open the HTML portals through a local static server and configure them to use the local API at `http://localhost:3000`.

## Azure deployment

The Bicep entry point is [`infra/main.bicep`](./infra/main.bicep), with parameters in [`infra/main.parameters.json`](./infra/main.parameters.json). Production secrets are stored in Azure Key Vault and referenced by App Service configuration. Do not put Azure keys, database passwords, JWT secrets, SAS keys, or client credentials in HTML, workflow exports, or source control.

See [`AZURE_MIGRATION_GUIDE.md`](./AZURE_MIGRATION_GUIDE.md) for the database migration, Blob upload/download flow, API contract, security checklist, and Azure architecture details.

## Main API capabilities

- JWT administrator authentication
- Tenant-scoped customer records
- Azure PostgreSQL customer and document metadata
- Short-lived Azure Blob SAS upload and download URLs
- Upload completion verification
- Azure AI support chat through `POST /support/chat`
- Health monitoring through `GET /healthz`

## Security

This repository is public by request. It intentionally excludes:

- `.env` and secret configuration files
- Azure credentials, storage keys, database passwords, and JWT secrets
- `node_modules`
- Deployment archives
- Copilot/Azure session state

Review every workflow export before adding real credentials. Rotate any credential that may have been exposed outside Azure Key Vault.

## License

No license has been granted yet. All rights are reserved unless a license is added to this repository.
