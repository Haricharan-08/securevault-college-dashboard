import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const schemaPath = fileURLToPath(new URL('../schema.sql', import.meta.url));
const schema = await readFile(schemaPath, 'utf8');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
try {
  await pool.query(schema);
  console.info('SecureVault schema is ready.');
} finally {
  await pool.end();
}
