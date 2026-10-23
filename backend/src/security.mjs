import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_BYTES = 64;

export function newSecret(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function digestSessionToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function digestRfid(uid, key) {
  return createHmac('sha256', key).update(uid, 'utf8').digest('hex');
}

export function normalizeRfid(value) {
  return String(value ?? '').replace(/[\s:-]/g, '').toUpperCase();
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_BYTES, SCRYPT_OPTIONS);
  return `scrypt$` + SCRYPT_OPTIONS.N + `$` + SCRYPT_OPTIONS.r + `$` + SCRYPT_OPTIONS.p + `$` + salt.toString('base64url') + `$` + Buffer.from(derived).toString('base64url');
}

export async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, saltText, keyText] = String(encoded ?? '').split('$');
  if (algorithm !== 'scrypt' || !/^\d+$/.test(n) || !/^\d+$/.test(r) || !/^\d+$/.test(p) || !saltText || !keyText) return false;
  const N = Number(n), R = Number(r), P = Number(p);
  if (N !== 32768 || R !== 8 || P !== 1) return false;
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(keyText, 'base64url');
  if (salt.length < 16 || expected.length !== KEY_BYTES) return false;
  const maxmem = Math.max(64 * 1024 * 1024, 128 * N * R + 16 * 1024 * 1024);
  const derived = Buffer.from(await scrypt(password, salt, expected.length, { N, r: R, p: P, maxmem }));
  return timingSafeEqual(derived, expected);
}

export function safeEqualText(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
