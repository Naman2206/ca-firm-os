# CA Firm OS Azure Deployment Plan

## Status
Ready for Validation

## Mode
Modify existing Azure deployment.

## Deployment target
- Node.js 20 Express API on existing Azure App Service.
- Existing Azure Static Web Apps for admin and client portals.
- Existing Azure PostgreSQL, Blob Storage, Azure AI, Key Vault, and Document Intelligence resources.

## Changes to deploy
- Server-side client and document context for Azure AI support chat.
- Azure Document Intelligence OCR during document upload completion.
- OCR extraction status and extracted text persistence.
- Admin Documents tab client-name display.
- Updated environment documentation.

## Validation scope
- Node syntax check.
- Existing production health endpoint.
- App Service settings for Document Intelligence.
- PostgreSQL OCR columns.
- Static portal deployment verification.

## All validation checks pass
- `npm run check` passed for `platform-api`.
- Production `/healthz` returned database `connected` and storage `configured`.
- Document Intelligence endpoint and Key Vault key reference are configured on App Service.
- OCR columns were applied to production PostgreSQL.
- Admin and client Static Web Apps deployed successfully.

## Validation Proof
- 2026-09-16: `node --check src/server.js` passed.
- 2026-09-16: `GET https://app-ca-firm-os-prod-a6fc.azurewebsites.net/healthz` passed.
- 2026-09-16: App Service OCR settings verified.
- 2026-09-16: Production OCR schema migration completed.
- 2026-09-16: Static Web Apps deployment completed for admin and client portals.

## Deployment method
Azure CLI zip deployment for the existing App Service and Static Web Apps CLI for static portals.

## Security
- Document Intelligence key remains in Key Vault/App Service configuration.
- No secrets are committed to source control.
