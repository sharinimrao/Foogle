// One-off schema runner. Usage: node scripts/migrate.mjs
// Requires POSTGRES_URL in the environment (`vercel env pull .env.local` first).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sql } from '@vercel/postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const schemaPath = join(__dirname, '..', 'db', 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf8');

  // @vercel/postgres's sql`` tag only runs one statement at a time, so split
  // the file on statement-terminating semicolons (none of our DDL contains
  // semicolons inside strings, so a plain split is safe here).
  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    console.log('Running:', statement.split('\n')[0].slice(0, 80));
    await sql.query(statement);
  }

  console.log(`\nDone — ${statements.length} statements applied.`);

  const { rows } = await sql.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  console.log('Tables now in public schema:', rows.map(r => r.table_name).join(', '));
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
