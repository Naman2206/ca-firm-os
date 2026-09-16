-- CA Firm OS multi-tenant SaaS schema
-- PostgreSQL + Supabase compatible. Store file bytes in Azure Blob Storage,
-- S3, Supabase Storage, or Google Cloud Storage;
-- this database stores metadata and tenant-scoped storage keys.

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan_code text not null default 'starter' check (plan_code in ('starter', 'professional', 'enterprise')),
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'suspended', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  password_hash text not null,
  full_name text not null,
  role text not null default 'admin' check (role in ('owner', 'admin', 'staff', 'viewer')),
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  external_client_id text,
  legal_name text not null,
  customer_type text,
  pan text,
  gstin text,
  email text,
  phone text,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, external_client_id)
);

alter table customers add column if not exists portal_token_hash text;
alter table customers add column if not exists portal_token_expires_at timestamptz;
alter table customers add column if not exists onboarding_status text not null default 'pending';
alter table customers drop constraint if exists customers_onboarding_status_check;
alter table customers add constraint customers_onboarding_status_check check (onboarding_status in ('pending', 'completed'));
create index if not exists customers_portal_token_idx on customers(portal_token_hash);

create table if not exists customer_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  uploaded_by uuid references admin_users(id) on delete set null,
  storage_provider text not null default 'azure_blob' check (storage_provider in ('azure_blob', 'supabase', 's3', 'gcs')),
  storage_bucket text not null,
  storage_key text not null,
  original_name text not null,
  mime_type text,
  byte_size bigint not null default 0 check (byte_size >= 0),
  document_type text,
  fiscal_year text,
  extracted_text text,
  extraction_status text not null default 'not_started' check (extraction_status in ('not_started', 'processing', 'completed', 'failed')),
  extracted_at timestamptz,
  extraction_error text,
  status text not null default 'uploaded' check (status in ('uploaded', 'pending_upload', 'pending_review', 'approved', 'rejected', 'deleted')),
  checksum text,
  created_at timestamptz not null default now(),
  unique (tenant_id, storage_bucket, storage_key)
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references tenants(id) on delete cascade,
  provider text not null default 'stripe',
  provider_customer_id text,
  provider_subscription_id text,
  plan_code text not null default 'starter',
  seats integer not null default 1 check (seats > 0),
  current_period_start timestamptz,
  current_period_end timestamptz,
  status text not null default 'trialing',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  event_type text not null,
  quantity numeric not null default 1 check (quantity >= 0),
  source text not null default 'dashboard',
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor_user_id uuid references admin_users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists compliance_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  client_id uuid references customers(id) on delete set null,
  client_name text,
  compliance_type text not null,
  due_date date,
  status text not null default 'pending',
  reminder_count integer not null default 0,
  last_reminder_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  source text,
  requirement text,
  urgency text,
  status text not null default 'new',
  followup_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  client_id uuid references customers(id) on delete set null,
  client_name text,
  phone text,
  email text,
  service text,
  amount numeric not null default 0 check (amount >= 0),
  currency text not null default 'INR',
  due_date date,
  status text not null default 'pending',
  reminder_count integer not null default 0,
  last_reminder_date date,
  escalated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_tenant_idx on customers(tenant_id, status);
create index if not exists files_customer_idx on customer_files(tenant_id, customer_id, created_at desc);
create index if not exists files_type_idx on customer_files(tenant_id, document_type, fiscal_year);
create index if not exists compliance_tenant_date_idx on compliance_items(tenant_id, due_date);
create index if not exists leads_tenant_date_idx on leads(tenant_id, created_at desc);
create index if not exists invoices_tenant_date_idx on invoices(tenant_id, due_date);
create index if not exists usage_tenant_date_idx on usage_events(tenant_id, occurred_at desc);
create index if not exists audit_tenant_date_idx on audit_logs(tenant_id, created_at desc);

-- Tenant-safe query examples for the API service:
-- select * from customers where tenant_id = :tenant_id and status = 'active';
-- select * from customer_files where tenant_id = :tenant_id and customer_id = :customer_id;
-- Always derive tenant_id from the verified access token, never from browser input.

alter table tenants enable row level security;
alter table admin_users enable row level security;
alter table customers enable row level security;
alter table customer_files enable row level security;
alter table subscriptions enable row level security;
alter table usage_events enable row level security;
alter table audit_logs enable row level security;
alter table compliance_items enable row level security;
alter table leads enable row level security;
alter table invoices enable row level security;

-- The API should set this transaction-local value after verifying the JWT:
-- set local app.tenant_id = 'tenant-uuid';
-- Policies below prevent cross-firm reads even if an endpoint is misused.
create policy tenant_isolation on tenants using (id::text = current_setting('app.tenant_id', true));
create policy admin_user_isolation on admin_users using (tenant_id::text = current_setting('app.tenant_id', true));
create policy customer_isolation on customers using (tenant_id::text = current_setting('app.tenant_id', true));
create policy file_isolation on customer_files using (tenant_id::text = current_setting('app.tenant_id', true));
create policy subscription_isolation on subscriptions using (tenant_id::text = current_setting('app.tenant_id', true));
create policy usage_isolation on usage_events using (tenant_id::text = current_setting('app.tenant_id', true));
create policy audit_isolation on audit_logs using (tenant_id::text = current_setting('app.tenant_id', true));
create policy compliance_isolation on compliance_items using (tenant_id::text = current_setting('app.tenant_id', true));
create policy lead_isolation on leads using (tenant_id::text = current_setting('app.tenant_id', true));
create policy invoice_isolation on invoices using (tenant_id::text = current_setting('app.tenant_id', true));
