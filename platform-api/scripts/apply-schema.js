const fs = require('node:fs');
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

client.connect()
  .then(() => client.query(fs.readFileSync(process.env.DB_SCHEMA_PATH, 'utf8')))
  .then(() => {
    console.log('SCHEMA_APPLIED');
    return client.end();
  })
  .catch(error => {
    console.error(`Schema application failed: ${error.message}`);
    return client.end().then(() => process.exit(1));
  });
