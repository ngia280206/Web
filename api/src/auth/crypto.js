import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

export const randomToken = () => randomBytes(32).toString('base64url');
// Keyed hashes also protect low-entropy OTP/CAPTCHA values from a database-only leak.
export const digest = (secret, value) => createHmac('sha256', secret).update(value).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, options);
  return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`;
}
export async function checkPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$32768$8$3') return false;
  const key = await derive(password, parts[4], 64, options);
  const expected = Buffer.from(parts[5], 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}
