import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { digestRfid, digestSessionToken, hashPassword, newSecret, normalizeRfid, safeEqualText, verifyPassword } from './security.mjs';

const { Pool } = pg;
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
const PORT = Number(process.env.PORT || 8081);
const SESSION_HOURS = 8;
const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 60;
let dummyPasswordHash;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be a valid TCP port.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN.includes('*')) throw new Error('Set CORS_ORIGIN to the exact dashboard origin.');
if (!process.env.API_DEVICE_TOKEN || Buffer.byteLength(process.env.API_DEVICE_TOKEN) < 32) throw new Error('API_DEVICE_TOKEN must be at least 32 bytes.');
if (!process.env.RFID_HASH_KEY || Buffer.byteLength(process.env.RFID_HASH_KEY) < 32) throw new Error('RFID_HASH_KEY must be at least 32 bytes.');
if (!/^[A-Za-z0-9_-]{1,64}$/.test(process.env.API_VAULT_DEVICE_ID || '')) throw new Error('API_VAULT_DEVICE_ID must be configured.');
if (process.env.NODE_ENV === 'production' && (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_VERIFY_SERVICE_SID)) throw new Error('Production requires all Twilio Verify credentials.');

const loginLimiter = rateLimit({ windowMs: 900000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false });
const otpLimiter = rateLimit({ windowMs: 900000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const provisioningLimiter = rateLimit({ windowMs: 900000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== '0') {
  const hops = Number(process.env.TRUST_PROXY);
  if (!Number.isInteger(hops) || hops < 1 || hops > 5) throw new Error('TRUST_PROXY must be 0 or a small trusted proxy hop count.');
  app.set('trust proxy', hops);
}

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.get('origin');
  res.vary('Origin');
  if (origin && !safeEqualText(origin, process.env.CORS_ORIGIN)) return res.status(403).json({ error: 'Origin not allowed.' });
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '16kb', strict: true }));
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => console.info(JSON.stringify({ event: 'http', method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started })));
  next();
});

function fail(res, status, message) { return res.status(status).json({ error: message }); }
function bodyObject(req) { return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}; }
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }
function cleanUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role, phoneNumber: row.phone_e164, phoneVerified: row.phone_verified, active: row.active, mustChangePassword: row.must_change_password, createdAt: row.created_at };
}
function emailValue(value) {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
function phoneValue(value) {
  const phone = String(value ?? '').trim();
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
function bearer(req) {
  const match = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(req.get('authorization') || '');
  return match ? match[1] : null;
}

async function requireSession(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) return fail(res, 401, 'Sign in required.');
    const result = await pool.query('SELECT s.token_digest, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_digest = $1 AND s.expires_at > NOW() AND u.active = TRUE', [digestSessionToken(token)]);
    if (!result.rowCount) return fail(res, 401, 'Session expired. Sign in again.');
    req.sessionTokenDigest = result.rows[0].token_digest;
    req.user = result.rows[0];
    next();
  } catch (error) { next(error); }
}
function requireRole(role) { return (req, res, next) => req.user?.role === role ? next() : fail(res, 403, 'This account cannot perform that action.'); }
function requirePasswordChanged(req, res, next) { return req.user?.must_change_password ? fail(res, 403, 'Change the temporary password first.') : next(); }
function requireDevice(req, res, next) {
  const token = bearer(req);
  if (!token || !safeEqualText(token, process.env.API_DEVICE_TOKEN)) return fail(res, 401, 'Device authentication failed.');
  next();
}

async function twilioRequest(resource, params) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: auth, TWILIO_VERIFY_SERVICE_SID: service } = process.env;
  if (!sid || !auth || !service) throw Object.assign(new Error('SMS delivery is not configured.'), { statusCode: 503 });
  const url = 'https://verify.twilio.com/v2/Services/' + encodeURIComponent(service) + '/' + resource;
  const credentials = Buffer.from(sid + ':' + auth).toString('base64');
  const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Basic ' + credentials, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(7000) });
  const payload = await response.json().catch(() => ({}));
  if (resource === 'VerificationCheck' && (response.status === 400 || response.status === 404)) return { approved: false };
  if (!response.ok) throw Object.assign(new Error('SMS provider request failed.'), { statusCode: response.status === 429 ? 503 : 502 });
  return resource === 'Verifications' ? payload : { approved: payload.status === 'approved' };
}

async function startChallenge(userId, purpose, phone) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query('SELECT id, phone_e164, phone_verified, active FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!user.rowCount || !user.rows[0].active || user.rows[0].phone_e164 !== phone) {
      await client.query('ROLLBACK');
      return { error: 'That account cannot receive an OTP.' };
    }
    if (purpose === 'vault_access' && !user.rows[0].phone_verified) {
      await client.query('ROLLBACK');
      return { error: 'Verify the account phone before requesting a vault OTP.' };
    }
    const recent = await client.query("SELECT 1 FROM otp_challenges WHERE user_id = $1 AND purpose = $2 AND created_at > NOW() - ($3 * INTERVAL '1 second') LIMIT 1", [userId, purpose, OTP_RESEND_SECONDS]);
    if (recent.rowCount) {
      await client.query('ROLLBACK');
      return { error: 'Wait 60 seconds before requesting another code.', status: 429 };
    }
    const sent = await twilioRequest('Verifications', { To: phone, Channel: 'sms' });
    const challengeId = randomUUID();
    await client.query("INSERT INTO otp_challenges (id, user_id, purpose, provider_sid, expires_at) VALUES ($1, $2, $3, $4, NOW() + ($5 * INTERVAL '1 minute'))", [challengeId, userId, purpose, sent.sid || 'twilio-verify', OTP_TTL_MINUTES]);
    await client.query('COMMIT');
    return { challengeId, expiresInSeconds: OTP_TTL_MINUTES * 60 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function checkChallenge(userId, challengeId, purpose, code) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT c.id, c.attempts, c.expires_at, c.consumed_at, u.phone_e164, u.active FROM otp_challenges c JOIN users u ON u.id = c.user_id WHERE c.id = $1 AND c.user_id = $2 AND c.purpose = $3 FOR UPDATE OF c', [challengeId, userId, purpose]);
    const row = result.rows[0];
    if (!row || !row.active || row.consumed_at || new Date(row.expires_at) <= new Date() || row.attempts >= OTP_MAX_ATTEMPTS) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1', [challengeId]);
    let checked;
    try { checked = await twilioRequest('VerificationCheck', { To: row.phone_e164, Code: code }); }
    catch (error) { await client.query('COMMIT'); throw error; }
    if (checked.approved) {
      await client.query('UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1', [challengeId]);
      if (purpose === 'phone_verify') await client.query('UPDATE users SET phone_verified = TRUE WHERE id = $1 AND active = TRUE', [userId]);
    }
    await client.query('COMMIT');
    return checked.approved;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

app.get('/healthz', async (req, res, next) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok' }); }
  catch (error) { next(error); }
});
app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const body = bodyObject(req), email = emailValue(body.email), password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password || password.length > 128) return fail(res, 400, 'Enter a valid email and password.');
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    const valid = await verifyPassword(password, user?.password_hash || dummyPasswordHash);
    if (!user || !user.active || !valid) return fail(res, 401, 'Email or password is incorrect.');
    const token = newSecret(), expiresAt = new Date(Date.now() + SESSION_HOURS * 3600000);
    await pool.query('INSERT INTO sessions (token_digest, user_id, expires_at) VALUES ($1, $2, $3)', [digestSessionToken(token), user.id, expiresAt]);
    res.json({ token, expiresAt, user: cleanUser(user) });
  } catch (error) { next(error); }
});
app.get('/api/auth/me', requireSession, (req, res) => res.json({ user: cleanUser(req.user) }));
app.post('/api/auth/logout', requireSession, async (req, res, next) => {
  try { await pool.query('DELETE FROM sessions WHERE token_digest = $1', [req.sessionTokenDigest]); res.sendStatus(204); }
  catch (error) { next(error); }
});
app.post('/api/auth/change-password', requireSession, async (req, res, next) => {
  try {
    const password = bodyObject(req).newPassword;
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) return fail(res, 400, 'Choose a password between 12 and 128 characters.');
    await pool.query('UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2', [await hashPassword(password), req.user.id]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [req.user.id]);
    res.json({ message: 'Password updated. Sign in again.' });
  } catch (error) { next(error); }
});
app.post('/api/account/phone/send-verification', requireSession, requirePasswordChanged, requireRole('user'), otpLimiter, async (req, res, next) => {
  try {
    if (!req.user.phone_e164) return fail(res, 400, 'Ask the Seller Admin to add your phone number.');
    const challenge = await startChallenge(req.user.id, 'phone_verify', req.user.phone_e164);
    if (challenge.error) return fail(res, challenge.status || 400, challenge.error);
    res.status(202).json(challenge);
  } catch (error) { next(error); }
});
app.post('/api/account/phone/verify', requireSession, requirePasswordChanged, requireRole('user'), otpLimiter, async (req, res, next) => {
  try {
    const body = bodyObject(req);
    if (!isUuid(body.challengeId) || !/^\d{4,10}$/.test(String(body.code || ''))) return fail(res, 400, 'Enter the verification code from SMS.');
    const valid = await checkChallenge(req.user.id, body.challengeId, 'phone_verify', String(body.code));
    if (!valid) return fail(res, 400, 'The code is invalid, expired, or already used.');
    res.json({ phoneVerified: true });
  } catch (error) { next(error); }
});
app.get('/api/admin/users', requireSession, requirePasswordChanged, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id, name, email, role, phone_e164, phone_verified, active, must_change_password, created_at FROM users WHERE role = 'user' ORDER BY created_at DESC LIMIT 500");
    res.json({ users: result.rows.map(cleanUser) });
  } catch (error) { next(error); }
});
app.post('/api/admin/users', requireSession, requirePasswordChanged, requireRole('admin'), provisioningLimiter, async (req, res, next) => {
  try {
    const body = bodyObject(req), name = String(body.name ?? '').trim(), email = emailValue(body.email), phone = phoneValue(body.phoneNumber), rfid = normalizeRfid(body.rfidCardId);
    if (!name || name.length > 80 || !email || !phone || !/^[A-F0-9]{6,32}$/.test(rfid)) return fail(res, 400, 'Provide a name, valid email, E.164 phone, and RFID card ID.');
    const tempPassword = newSecret(24), passwordHash = await hashPassword(tempPassword), id = randomUUID(), rfidDigest = digestRfid(rfid, process.env.RFID_HASH_KEY);
    await pool.query("INSERT INTO users (id, name, email, role, password_hash, phone_e164, rfid_digest, must_change_password) VALUES ($1, $2, $3, 'user', $4, $5, $6, TRUE)", [id, name, email, passwordHash, phone, rfidDigest]);
    res.status(201).json({ user: { id, name, email, role: 'user', phoneNumber: phone, phoneVerified: false, active: true, mustChangePassword: true }, temporaryPassword: tempPassword });
  } catch (error) {
    if (error.code === '23505') return fail(res, 409, 'That email or RFID card is already registered.');
    next(error);
  }
});
app.patch('/api/admin/users/:id/status', requireSession, requirePasswordChanged, requireRole('admin'), provisioningLimiter, async (req, res, next) => {
  try {
    if (!isUuid(req.params.id) || typeof bodyObject(req).active !== 'boolean') return fail(res, 400, 'Provide a valid user ID and active status.');
    const result = await pool.query("UPDATE users SET active = $1 WHERE id = $2 AND role = 'user' RETURNING id, name, email, role, phone_e164, phone_verified, active, must_change_password, created_at", [req.body.active, req.params.id]);
    if (!result.rowCount) return fail(res, 404, 'User account not found.');
    if (!req.body.active) await pool.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
    res.json({ user: cleanUser(result.rows[0]) });
  } catch (error) { next(error); }
});
app.post('/api/device/otp/request', requireDevice, otpLimiter, async (req, res, next) => {
  try {
    const body = bodyObject(req);
    if (body.deviceId !== process.env.API_VAULT_DEVICE_ID || !isUuid(body.userId)) return fail(res, 400, 'Invalid device or user.');
    const result = await pool.query("SELECT id, phone_e164, phone_verified FROM users WHERE id = $1 AND role = 'user' AND active = TRUE", [body.userId]);
    const user = result.rows[0];
    if (!user?.phone_e164 || !user.phone_verified) return fail(res, 403, 'This account is not ready for vault OTP delivery.');
    const challenge = await startChallenge(user.id, 'vault_access', user.phone_e164);
    if (challenge.error) return fail(res, challenge.status || 400, challenge.error);
    res.status(202).json(challenge);
  } catch (error) { next(error); }
});
app.post('/api/device/otp/verify', requireDevice, otpLimiter, async (req, res, next) => {
  try {
    const body = bodyObject(req);
    if (body.deviceId !== process.env.API_VAULT_DEVICE_ID || !isUuid(body.userId) || !isUuid(body.challengeId) || !/^\d{4,10}$/.test(String(body.code || ''))) return fail(res, 400, 'Invalid verification request.');
    res.json({ verified: await checkChallenge(body.userId, body.challengeId, 'vault_access', String(body.code)) });
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => {
  const status = Number(error.statusCode || error.status) || 500;
  console.error(JSON.stringify({ event: 'request_error', path: req.path, status }));
  if (res.headersSent) return next(error);
  res.status(status).json({ error: status >= 500 ? 'The service could not complete this request.' : 'Invalid request.' });
});

async function bootstrapAdmin() {
  const email = emailValue(process.env.BOOTSTRAP_ADMIN_EMAIL), password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email && !password) return;
  if (!email || typeof password !== 'string' || password.length < 16 || password.length > 128) throw new Error('Bootstrap admin needs a valid email and 16–128 character password.');
  const existing = await pool.query('SELECT role FROM users WHERE email = $1', [email]);
  if (existing.rowCount) {
    if (existing.rows[0].role !== 'admin') throw new Error('Bootstrap email already belongs to a non-admin account.');
    return;
  }
  await pool.query("INSERT INTO users (id, name, email, role, password_hash, active, must_change_password) VALUES ($1, $2, $3, 'admin', $4, TRUE, FALSE)", [randomUUID(), String(process.env.BOOTSTRAP_ADMIN_NAME || 'Seller Admin').slice(0, 80), email, await hashPassword(password)]);
  console.info(JSON.stringify({ event: 'bootstrap_admin_created', email }));
}

async function main() {
  dummyPasswordHash = await hashPassword(newSecret(32));
  await pool.query('SELECT 1');
  await bootstrapAdmin();
  await pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
  app.listen(PORT, () => console.info(JSON.stringify({ event: 'api_started', port: PORT, otpConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID) })));
}
main().catch((error) => {
  console.error(JSON.stringify({ event: 'startup_failed', message: error.message }));
  process.exit(1);
});
