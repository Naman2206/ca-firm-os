const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
  process.exit(1);
}

client.connect()
  .then(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    const tenant = await client.query(
      `insert into tenants (name, slug, plan_code, status)
       values ($1, $2, 'professional', 'active')
       on conflict (slug) do update set name = excluded.name
       returning id`,
      ['Mehtas CA Firm', 'mehtas-ca-firm']
    );
    await client.query(
      `insert into admin_users (tenant_id, email, password_hash, full_name, role)
       values ($1, $2, $3, $4, 'owner')
       on conflict (tenant_id, email) do update
       set password_hash = excluded.password_hash, full_name = excluded.full_name, is_active = true`,
      [tenant.rows[0].id, email, passwordHash, 'CA Firm Administrator']
    );
    console.log('ADMIN_SEEDED');
  })
  .then(() => client.end())
  .catch(error => {
    console.error(`Admin seeding failed: ${error.message}`);
    return client.end().then(() => process.exit(1));
  });
