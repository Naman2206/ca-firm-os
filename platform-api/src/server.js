require('dotenv').config();

const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { DefaultAzureCredential } = require('@azure/identity');
const { BlobSASPermissions, SASProtocol, generateBlobSASQueryParameters, StorageSharedKeyCredential, BlobServiceClient } = require('@azure/storage-blob');

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET;
const accessTokenTtl = process.env.ACCESS_TOKEN_TTL || '15m';
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
const database = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX || 10), idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 }) : null;
const azureAiEndpoint = String(process.env.AZURE_AI_ENDPOINT || '').replace(/\/$/, '');
const azureAiDeployment = process.env.AZURE_AI_DEPLOYMENT || '';
const azureAiApiKey = process.env.AZURE_AI_API_KEY || '';
const documentIntelligenceEndpoint = String(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || '').replace(/\/$/, '');
const documentIntelligenceKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '';
const azureAiCredential = new DefaultAzureCredential();

if (!jwtSecret) console.warn('JWT_SECRET is not configured; login and protected routes will be unavailable.');

app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false, credentials: true }));
app.use(express.json({ limit: '1mb' }));

function apiError(response, status, message) {
  return response.status(status).json({ error: message });
}

function requireDatabase(response) {
  if (!database) {
    apiError(response, 503, 'Database is not configured');
    return false;
  }
  return true;
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, tenant_id: user.tenant_id, role: user.role, email: user.email }, jwtSecret, { expiresIn: accessTokenTtl });
}

function hashPortalToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function requestAzureAiReply({ clientId, clientName, message, context }) {
  if (!azureAiEndpoint || !azureAiDeployment) throw new Error('Azure AI endpoint or deployment is not configured');
  const authorization = azureAiApiKey
    ? { 'api-key': azureAiApiKey }
    : (() => {
        return azureAiCredential.getToken('https://cognitiveservices.azure.com/.default').then(token => {
          if (!token?.token) throw new Error('Azure AI credential token unavailable');
          return { Authorization: `Bearer ${token.token}` };
        });
      })();
  const system = `You are the India tax and compliance support assistant for Mehtas Chartered Accountants.
Give concise, plain-language, source-aware answers about Indian GST, Income Tax, TDS/TCS, ITRs, audits, ROC/MCA, and bookkeeping.
Do not invent laws, deadlines, rates, sections, or sources. Ask a focused question when facts are missing. Keep every answer concise: provide the main answer first, normally in one or two sentences.
Escalate notices, assessments, appeals, tax planning, disputed classification, penalties, foreign income, crypto, transfer pricing, payroll disputes, and material legal or financial risk to a qualified CA.
Never request passwords, OTPs, card details, Aadhaar/PAN images in chat, or private API keys. Direct document sharing to the secure portal.
For document questions, use exact labeled values from the supplied OCR context. If a verified labeled field is present, it overrides any unlabeled or conflicting value elsewhere. For PAN questions, report the verified document PAN exactly as shown and do not substitute the profile PAN.
Client ID: ${clientId}
Client name: ${clientName}
Client context: ${JSON.stringify(context || {})}`;
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(`${azureAiEndpoint}/openai/deployments/${encodeURIComponent(azureAiDeployment)}/chat/completions?api-version=2024-10-21`, {
      method: 'POST',
      headers: { ...(await authorization), 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: message }], temperature: 0.2, max_tokens: 300 })
    });
    if (response.status !== 429 || attempt === 2) break;
    const retryAfter = Number(response.headers.get('retry-after')) || (attempt + 1) * 5;
    await new Promise(resolve => setTimeout(resolve, Math.min(retryAfter, 20) * 1000));
  }
  if (!response.ok) throw new Error(`Azure AI HTTP ${response.status}: ${await response.text()}`);
  const result = await response.json();
  const reply = result.choices?.[0]?.message?.content;
  if (!reply) throw new Error('Azure AI returned no reply');
  return reply;
}

function extractLabeledPan(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ');
  const panPattern = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/i;
  const labelPattern = /pan\s*(?:of\s*)?(?:the\s*)?(?:employee\s*\/\s*specified\s*senior\s*citizen|employee|specified\s*senior\s*citizen)|pan\s*(?:no\.?|number)?/ig;
  let match;
  while ((match = labelPattern.exec(normalized))) {
    const nearbyText = normalized.slice(match.index, match.index + 500);
    const pan = nearbyText.match(panPattern);
    if (pan) return pan[0].toUpperCase();
  }
  return null;
}

function extractEmployeePan(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ');
  const panPattern = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/ig;
  const candidates = [];
  let panMatch;
  while ((panMatch = panPattern.exec(normalized))) {
    const nearby = normalized.slice(Math.max(0, panMatch.index - 250), panMatch.index + 250);
    if (/\b(employee|senior\s+citizen)\b/i.test(nearby)) {
      const employeeIndex = nearby.search(/\b(employee|senior\s+citizen)\b/i);
      candidates.push({ value: panMatch[0].toUpperCase(), distance: Math.abs(employeeIndex - 250) });
    }
  }
  return candidates.sort((left, right) => left.distance - right.distance)[0]?.value || null;
}

async function extractDocumentText(blobName, mimeType) {
  if (!documentIntelligenceEndpoint || !documentIntelligenceKey) throw new Error('Azure Document Intelligence is not configured');
  const documentUrl = buildBlobSasUrl(blobName, 'r', 15);
  const analyze = await fetch(`${documentIntelligenceEndpoint}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': documentIntelligenceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ urlSource: documentUrl })
  });
  if (!analyze.ok) throw new Error(`Document Intelligence analyze HTTP ${analyze.status}: ${await analyze.text()}`);
  const operationUrl = analyze.headers.get('operation-location');
  if (!operationUrl) throw new Error('Document Intelligence did not return an operation URL');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const result = await fetch(operationUrl, { headers: { 'Ocp-Apim-Subscription-Key': documentIntelligenceKey } });
    if (!result.ok) throw new Error(`Document Intelligence result HTTP ${result.status}: ${await result.text()}`);
    const payload = await result.json();
    if (payload.status === 'succeeded') {
      const text = (payload.analyzeResult?.content || '').trim();
      return text.slice(0, 100000);
    }
    if (payload.status === 'failed') throw new Error(payload.error?.message || 'Document Intelligence extraction failed');
  }
  throw new Error('Document Intelligence extraction timed out');
}

function requireAuth(request, response, next) {
  if (!jwtSecret) return apiError(response, 503, 'Authentication is not configured');
  const header = request.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return apiError(response, 401, 'Bearer token required');
  try {
    request.user = jwt.verify(token, jwtSecret);
    return next();
  } catch {
    return apiError(response, 401, 'Invalid or expired access token');
  }

}

function requireAuthOrN8n(request, response, next) {
  const serviceToken = process.env.N8N_SERVICE_TOKEN;
  if (serviceToken && request.get('x-n8n-service-token') === serviceToken) return next();
  return requireAuth(request, response, next);
}

function normalizeFileName(fileName) {
  const normalized = String(fileName || 'client-document').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
  return normalized || 'client-document';
}

function storageCredentials() {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
  const container = process.env.AZURE_STORAGE_CONTAINER || 'client-documents';
  if (!accountName || !accountKey) return null;
  return { accountName, accountKey, container };
}

function blobServiceClient() {
  const storage = storageCredentials();
  if (!storage) throw new Error('Azure Blob Storage credentials are not configured');
  return new BlobServiceClient(`https://${storage.accountName}.blob.core.windows.net`, new StorageSharedKeyCredential(storage.accountName, storage.accountKey));
}

function buildBlobSasUrl(blobName, permissions, expiresInMinutes = 10) {
  const storage = storageCredentials();
  if (!storage) throw new Error('Azure Blob Storage credentials are not configured');
  const credential = new StorageSharedKeyCredential(storage.accountName, storage.accountKey);
  const startsOn = new Date(Date.now() - 60 * 1000);
  const expiresOn = new Date(Date.now() + expiresInMinutes * 60 * 1000);
  const sas = generateBlobSASQueryParameters({ containerName: storage.container, blobName, permissions: BlobSASPermissions.parse(permissions), startsOn, expiresOn, protocol: SASProtocol.Https }, credential).toString();
  return `https://${storage.accountName}.blob.core.windows.net/${storage.container}/${encodeURIComponent(blobName).replace(/%2F/g, '/')}?${sas}`;
}

function formatAmount(value) {
  const amount = Number(value || 0);
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  return `₹${amount.toLocaleString('en-IN')}`;
}

async function queryRows(text, values) {
  const result = await database.query(text, values);
  return result.rows;
}

app.get('/healthz', async (request, response) => {
  let databaseStatus = 'not-configured';
  if (database) {
    try {
      await database.query('select 1');
      databaseStatus = 'connected';
    } catch {
      databaseStatus = 'unavailable';
    }
  }
  response.status(databaseStatus === 'unavailable' ? 503 : 200).json({ status: databaseStatus === 'unavailable' ? 'degraded' : 'ok', database: databaseStatus, storage: storageCredentials() ? 'configured' : 'not-configured' });
});

app.post('/auth/login', async (request, response) => {
  if (!requireDatabase(response) || !jwtSecret) return;
  const email = String(request.body?.email || '').trim().toLowerCase();
  const password = String(request.body?.password || '');
  if (!email || !password) return apiError(response, 400, 'email and password are required');
  try {
    const rows = await queryRows(`select u.id, u.tenant_id, u.email, u.password_hash, u.full_name, u.role, t.name as tenant_name, t.plan_code from admin_users u join tenants t on t.id = u.tenant_id where lower(u.email) = $1 and u.is_active = true and t.status <> 'suspended' limit 1`, [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return apiError(response, 401, 'Invalid credentials');
    await database.query('update admin_users set last_login_at = now() where id = $1', [user.id]);
    return response.json({ access_token: issueToken(user), user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, tenant_name: user.tenant_name, plan: user.plan_code } });
  } catch (error) {
    console.error('Login failed', error);
    return apiError(response, 500, 'Login failed');
  }
});

app.post('/customers', requireAuth, async (request, response) => {
  if (!requireDatabase(response)) return;
  const name = String(request.body?.name || '').trim();
  const phone = String(request.body?.phone || '').trim() || null;
  const email = String(request.body?.email || '').trim().toLowerCase() || null;
  const pan = String(request.body?.pan || '').trim().toUpperCase() || null;
  const gstin = String(request.body?.gstin || '').trim().toUpperCase() || null;
  const customerType = String(request.body?.customer_type || '').trim() || null;
  const services = String(request.body?.services || '').trim();
  if (!name || (!phone && !email)) return apiError(response, 400, 'name and phone or email are required');
  try {
    const result = await database.query(
      `insert into customers (tenant_id, external_client_id, legal_name, customer_type, pan, gstin, email, phone, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id as client_id, legal_name as name, external_client_id, customer_type as client_type, pan, gstin, email, phone, status, created_at, updated_at`,
      [request.user.tenant_id, `WEB-${crypto.randomUUID()}`, name, customerType, pan, gstin, email, phone, JSON.stringify({ services })]
    );
    return response.status(201).json({ client: result.rows[0] });
  } catch (error) {
    console.error('Customer creation failed', error);
    return apiError(response, 500, 'Customer could not be created');
  }
});

app.post('/customers/:customerId/portal-link', requireAuth, async (request, response) => {
  if (!requireDatabase(response)) return;
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  try {
    const result = await database.query(
      'update customers set portal_token_hash = $1, portal_token_expires_at = $2, updated_at = now() where id = $3 and tenant_id = $4 and status <> \'archived\' returning id',
      [hashPortalToken(token), expiresAt, request.params.customerId, request.user.tenant_id]
    );
    if (!result.rowCount) return apiError(response, 404, 'Customer not found');
    const portalUrl = String(process.env.CLIENT_PORTAL_URL || 'https://witty-grass-0b260ac00.3.azurestaticapps.net/').replace(/\/$/, '');
    return response.json({ portal_url: `${portalUrl}/?access=${encodeURIComponent(token)}`, expires_at: expiresAt.toISOString() });
  } catch (error) {
    console.error('Client portal link creation failed', error);
    return apiError(response, 500, 'Client portal link could not be created');
  }
});

async function findPortalCustomer(token) {
  if (!database || !token) return null;
  const rows = await queryRows(
    `select id, tenant_id, legal_name, email, phone, gstin, pan
     from customers
     where portal_token_hash = $1 and portal_token_expires_at > now() and status = 'active'`,
    [hashPortalToken(token)]
  );
  return rows[0] || null;
}

app.get('/portal/profile', async (request, response) => {
  if (!requireDatabase(response)) return;
  try {
    const customer = await findPortalCustomer(String(request.query.access || ''));
    if (!customer) return apiError(response, 401, 'Invalid or expired client portal link');
    const files = await queryRows(
      `select id as file_id, original_name, mime_type, byte_size, document_type, fiscal_year, status, created_at
       from customer_files
       where tenant_id = $1 and customer_id = $2 and status <> 'deleted'
       order by created_at desc`,
      [customer.tenant_id, customer.id]
    );
    return response.json({ client: customer, documents: files });
  } catch (error) {
    console.error('Client portal profile lookup failed', error);
    return apiError(response, 500, 'Client portal could not be loaded');
  }
});

app.get('/portal/files/:fileId/download-url', async (request, response) => {
  if (!requireDatabase(response)) return;
  try {
    const customer = await findPortalCustomer(String(request.query.access || ''));
    if (!customer) return apiError(response, 401, 'Invalid or expired client portal link');
    const rows = await queryRows(
      `select original_name, mime_type, storage_key
       from customer_files
       where id = $1 and tenant_id = $2 and customer_id = $3 and status <> 'deleted'`,
      [request.params.fileId, customer.tenant_id, customer.id]
    );
    if (!rows.length) return apiError(response, 404, 'Document not found');
    return response.json({
      download_url: buildBlobSasUrl(rows[0].storage_key, 'r'),
      file_name: rows[0].original_name,
      mime_type: rows[0].mime_type,
      expires_in_seconds: 600
    });
  } catch (error) {
    console.error('Client portal document URL failed', error);
    return apiError(response, 500, 'Document could not be opened');
  }
});

app.post('/support/chat', requireAuthOrN8n, async (request, response) => {
  const clientId = String(request.body?.client_id || '').trim();
  const clientName = String(request.body?.client_name || 'client').trim();
  const message = String(request.body?.message || '').trim();
  if (!clientId || !message) return apiError(response, 400, 'client_id and message are required');
  try {
    const tenantId = request.user?.tenant_id;
    const customer = tenantId ? (await queryRows('select id, legal_name, customer_type, pan, gstin, email, phone, metadata, created_at, updated_at from customers where id = $1 and tenant_id = $2 and status <> \'archived\'', [clientId, tenantId]))[0] : null;
    if (tenantId && !customer) return apiError(response, 404, 'Client not found');
    const documents = tenantId ? (await queryRows('select original_name, document_type, fiscal_year, status, extracted_text, extraction_status, extracted_at, created_at from customer_files where customer_id = $1 and tenant_id = $2 and status <> \'deleted\' order by created_at desc', [clientId, tenantId])).slice(0, 4).map(document => {
      const extractedText = String(document.extracted_text || '');
      const searchableText = extractedText.toLowerCase();
      const terms = [
        ...message.toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length > 3),
        'total taxable income',
        'gross total income',
        'gross income',
        'total income',
        'salary income',
        'pan of the employee',
        'pan number',
        'pan no',
        'pan',
        'chapter vi-a',
        'deductions'
      ];
      const positions = [...new Set(terms.map(term => searchableText.indexOf(term)).filter(position => position >= 0))].sort((a, b) => a - b);
      const snippets = positions.slice(0, 6).map(position => extractedText.slice(Math.max(0, position - 350), position + 650));
      return {
        ...document,
        extracted_text: (snippets.length ? snippets.join('\n...\n') : extractedText.slice(0, 1200)).slice(0, 5000),
        verified_fields: {
          labeled_pan: extractLabeledPan(extractedText),
          employee_pan: extractEmployeePan(extractedText)
        }
      };
    }) : [];
    const serverContext = { submitted_profile: customer || request.body?.context || {}, documents };
    const isPanQuestion = /\bpan\b/i.test(message);
    const asksEmployeePan = /employee|senior\s+citizen/i.test(message);
    const panDocuments = asksEmployeePan
      ? [...documents].sort((left, right) => {
          const formPattern = /form\s*16|12ba/i;
          return Number(formPattern.test(right.original_name || '')) - Number(formPattern.test(left.original_name || ''));
        })
      : documents;
    const labeledPans = panDocuments.flatMap(document => asksEmployeePan
      ? [document.verified_fields?.employee_pan, document.verified_fields?.labeled_pan]
      : [document.verified_fields?.labeled_pan]).filter(Boolean);
    if (isPanQuestion && labeledPans.length) {
      const uniquePans = [...new Set(labeledPans)];
      const reply = uniquePans[0];
      return response.json({ reply, provider: 'document-grounded-extraction' });
    }
    const reply = await requestAzureAiReply({ clientId, clientName: customer?.legal_name || clientName, message, context: serverContext });
    return response.json({ reply, provider: 'azure-ai' });
  } catch (error) {
    console.error('Azure AI support request failed', error);
    return apiError(response, 502, 'Azure AI support is unavailable');
  }
});

app.get('/dashboard', requireAuth, async (request, response) => {
  if (!requireDatabase(response)) return;
  const tenantId = request.user.tenant_id;
  try {
    const [tenant, clients, deadlines, documents, leads, invoices] = await Promise.all([
      queryRows('select id, name, plan_code as plan, status from tenants where id = $1', [tenantId]),
      queryRows('select id as client_id, legal_name as name, external_client_id, customer_type as client_type, pan, gstin, email, phone, status, created_at, updated_at from customers where tenant_id = $1 and status <> \'archived\' order by updated_at desc', [tenantId]),
      queryRows('select id as compliance_id, client_id, client_name, compliance_type, due_date, status, reminder_count, last_reminder_date from compliance_items where tenant_id = $1 order by due_date asc', [tenantId]),
      queryRows('select id as doc_id, customer_id as client_id, original_name as document_name, document_type as compliance_type, fiscal_year, created_at as requested_date, status, mime_type, byte_size, extraction_status from customer_files where tenant_id = $1 and status <> \'deleted\' order by created_at desc', [tenantId]),
      queryRows('select id as lead_id, name, phone, email, source, requirement, urgency, status, followup_date, created_at from leads where tenant_id = $1 order by created_at desc', [tenantId]),
      queryRows('select id as invoice_id, client_id, client_name, phone, email, service, amount, currency, due_date, status, reminder_count, last_reminder_date, escalated from invoices where tenant_id = $1 order by due_date asc', [tenantId])
    ]);
    const open = value => !['paid', 'closed', 'completed', 'done', 'received'].includes(String(value || '').toLowerCase());
    const daysUntil = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 9999 : Math.ceil((date - new Date()) / 86400000); };
    const pendingDeadlines = deadlines.filter(row => open(row.status));
    const pendingDocuments = documents.filter(row => open(row.status));
    const pendingInvoices = invoices.filter(row => open(row.status));
    const paidAmount = invoices.filter(row => String(row.status).toLowerCase() === 'paid').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const pendingAmount = pendingInvoices.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const tasks = [
      ...pendingDeadlines.map(row => ({ id: row.compliance_id, title: row.compliance_type || 'Compliance filing', client: row.client_name, due_date: row.due_date, status: row.status || 'Pending', priority: daysUntil(row.due_date) <= 3 ? 'Urgent' : 'High', source: 'Compliance' })),
      ...pendingDocuments.map(row => ({ id: row.doc_id, title: `Collect ${row.document_name || 'document'}`, client: row.client_id, due_date: row.requested_date, status: row.status || 'Pending', priority: 'Medium', source: 'Documents' })),
      ...pendingInvoices.filter(row => daysUntil(row.due_date) < 0).map(row => ({ id: row.invoice_id, title: `Follow up invoice ${row.invoice_id}`, client: row.client_name, due_date: row.due_date, status: row.status, priority: 'Urgent', source: 'Invoices' }))
    ];
    return response.json({ tenant: tenant[0] || null, clients: { total: clients.length, rows: clients }, deadlines: { pending: pendingDeadlines.length, urgent: pendingDeadlines.filter(row => daysUntil(row.due_date) <= 7).length, rows: deadlines }, documents: { pending: pendingDocuments.length, rows: documents }, leads: { active: leads.filter(row => open(row.status)).length, rows: leads }, invoices: { collected: formatAmount(paidAmount), pending: formatAmount(pendingAmount), overdueClients: pendingInvoices.filter(row => daysUntil(row.due_date) < 0).length, rows: invoices }, tasks, reports: { complianceRate: deadlines.length ? Math.round((deadlines.length - pendingDeadlines.length) / deadlines.length * 100) : 0, automationHours: 0 } });
  } catch (error) {
    console.error('Dashboard query failed', error);
    return apiError(response, 500, 'Dashboard data unavailable');
  }
});

app.post('/customers/:customerId/files/upload-url', requireAuth, async (request, response) => {
  if (!requireDatabase(response)) return;
  const { customerId } = request.params;
  const fileName = normalizeFileName(request.body?.file_name);
  const mimeType = String(request.body?.mime_type || 'application/octet-stream');
  const fiscalYear = String(request.body?.fiscal_year || 'unknown').replace(/[^0-9-]/g, '').slice(0, 9) || 'unknown';
  const documentType = String(request.body?.document_type || '').trim().slice(0, 100) || null;
  try {
    const customers = await queryRows('select id from customers where id = $1 and tenant_id = $2 and status <> \'archived\'', [customerId, request.user.tenant_id]);
    if (!customers.length) return apiError(response, 404, 'Customer not found');
    const blobName = `${request.user.tenant_id}/${customerId}/${fiscalYear}/${crypto.randomUUID()}/${fileName}`;
    const uploadUrl = buildBlobSasUrl(blobName, 'cw');
    const file = await database.query(`insert into customer_files (tenant_id, customer_id, uploaded_by, storage_provider, storage_bucket, storage_key, original_name, mime_type, document_type, fiscal_year, status) values ($1, $2, $3, 'azure_blob', $4, $5, $6, $7, $8, $9, 'pending_upload') returning id`, [request.user.tenant_id, customerId, request.user.sub, process.env.AZURE_STORAGE_CONTAINER || 'client-documents', blobName, fileName, mimeType, documentType, fiscalYear]);
    return response.status(201).json({ file_id: file.rows[0].id, storage_key: blobName, upload_url: uploadUrl, upload_headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': mimeType }, expires_in_seconds: 600 });
  } catch (error) {
    console.error('Upload URL creation failed', error);
    return apiError(response, 500, 'Upload URL unavailable');
  }
});

app.post('/files/:fileId/complete', requireAuth, async (request, response) => {
  if (!requireDatabase(response)) return;
  try {
    const rows = await queryRows('select storage_bucket, storage_key from customer_files where id = $1 and tenant_id = $2 and status = \'pending_upload\'', [request.params.fileId, request.user.tenant_id]);
    if (!rows.length) return apiError(response, 404, 'Pending upload not found');
    const blob = blobServiceClient().getContainerClient(rows[0].storage_bucket).getBlobClient(rows[0].storage_key);
    const properties = await blob.getProperties();
    await database.query('update customer_files set byte_size = $1, mime_type = coalesce(nullif($2, \'\'), mime_type), status = \'uploaded\', extraction_status = \'processing\', extraction_error = null where id = $3 and tenant_id = $4', [properties.contentLength || 0, properties.contentType || '', request.params.fileId, request.user.tenant_id]);
    let extractionStatus = 'processing';
    try {
      const extractedText = await extractDocumentText(rows[0].storage_key, properties.contentType || '');
      await database.query('update customer_files set extracted_text = $1, extraction_status = \'completed\', extracted_at = now(), extraction_error = null where id = $2 and tenant_id = $3', [extractedText, request.params.fileId, request.user.tenant_id]);
      extractionStatus = 'completed';
    } catch (extractionError) {
      console.error('Document OCR failed', extractionError);
      await database.query('update customer_files set extraction_status = \'failed\', extraction_error = $1 where id = $2 and tenant_id = $3', [String(extractionError.message || extractionError).slice(0, 1000), request.params.fileId, request.user.tenant_id]);
      extractionStatus = 'failed';
    }
    return response.json({ file_id: request.params.fileId, byte_size: properties.contentLength || 0, status: 'uploaded', extraction_status: extractionStatus });
  } catch (error) {
    console.error('Upload finalization failed', error);
    return apiError(response, 502, 'Uploaded file could not be verified in Azure Blob Storage');
  }
});

app.get('/customers/:customerId/files', requireAuth, async (request, response) => {
  if (!requireDatabase(response)) return;
  try {
    const rows = await queryRows('select id, original_name, mime_type, byte_size, document_type, fiscal_year, status, created_at from customer_files where tenant_id = $1 and customer_id = $2 and status <> \'deleted\' order by created_at desc', [request.user.tenant_id, request.params.customerId]);
    return response.json({ rows });
  } catch (error) {
    console.error('File listing failed', error);
    return apiError(response, 500, 'Files unavailable');
  }
});

app.get('/files/:fileId/download-url', requireAuth, async (request, response) => {
  if (!requireDatabase(response)) return;
  try {
    const rows = await queryRows('select storage_key from customer_files where id = $1 and tenant_id = $2 and status <> \'deleted\'', [request.params.fileId, request.user.tenant_id]);
    if (!rows.length) return apiError(response, 404, 'File not found');
    return response.json({ download_url: buildBlobSasUrl(rows[0].storage_key, 'r'), expires_in_seconds: 600 });
  } catch (error) {
    console.error('Download URL creation failed', error);
    return apiError(response, 500, 'Download URL unavailable');
  }
});

app.use((request, response) => apiError(response, 404, 'Route not found'));

app.listen(port, () => console.log(`Platform API listening on port ${port}`));
