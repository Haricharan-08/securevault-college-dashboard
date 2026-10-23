import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { hashPassword } from '../src/security.mjs';

const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const name = String(process.env.BOOTSTRAP_ADMIN_NAME || 'Seller Admin').trim().slice(0, 80);
if (!process.env.DATABASE_URL || !email || !password || password.length < 16 || password.length > 128) {
  throw new Error('Set DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL, and a unique 16–128 character BOOTSTRAP_ADMIN_PASSWORD in the private environment.');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
try {
  const existing = await pool.query('SELECT role FROM users WHERE email = $1', [email]);
  if (existing.rowCount) throw new Error('That email already has an account.');
  await pool.query(
    `INSERT INTO users (id, name, email, role, password_hash, active, must_change_password)
     VALUES ($1, $2, $3, 'admin', $4, TRUE, FALSE)`,
    [randomUUID(), name || 'Seller Admin', email, await hashPassword(password)]
  );
  console.info('Seller Admin account created.');
} finally {
  await pool.end();
}
