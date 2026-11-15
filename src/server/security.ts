import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let cachedMasterKey: Buffer | null = null;

/**
 * Loads or initializes a persistent 32-byte master key for AES-256-GCM and HMAC-SHA256.
 * Uses APP_ENCRYPTION_SECRET when configured, or persists a CSPRNG key in `.circle_key` (0600).
 */
export function getMasterKey(baseDir: string): Buffer {
  if (cachedMasterKey) return cachedMasterKey;

  const envSecret = process.env.APP_ENCRYPTION_SECRET || process.env.SESSION_SECRET;
  if (envSecret && envSecret.trim().length >= 16) {
    cachedMasterKey = crypto.scryptSync(envSecret.trim(), 'circle-workspace-master-v1', 32);
    return cachedMasterKey;
  }

  const keyFile = path.join(baseDir, '.circle_key');
  try {
    if (fs.existsSync(keyFile)) {
      const hex = fs.readFileSync(keyFile, 'utf-8').trim();
      if (/^[0-9a-fA-F]{64}$/.test(hex)) {
        cachedMasterKey = Buffer.from(hex, 'hex');
        return cachedMasterKey;
      }
    }
  } catch (err) {
    console.warn('Warning reading .circle_key:', err);
  }

  // Derive a stable deterministic key from workspace Firebase config (or stable workspace seed)
  // so active sessions and encrypted recovery/VAPID secrets survive container restarts when .circle_key is ephemeral.
  let seedMaterial = 'circle-workspace-asliri-enterprise-default-seed-2026';
  try {
    const fbPath = path.join(baseDir, 'firebase-applet-config.json');
    if (fs.existsSync(fbPath)) {
      const fb = JSON.parse(fs.readFileSync(fbPath, 'utf-8'));
      const fbSeed = [fb.projectId, fb.firestoreDatabaseId, fb.appId, fb.messagingSenderId]
        .filter(Boolean)
        .join(':');
      if (fbSeed) seedMaterial = fbSeed;
    }
  } catch {}

  const persistentKey = crypto.scryptSync(seedMaterial, 'circle-workspace-persistent-master-v1', 32);

  try {
    fs.writeFileSync(keyFile, persistentKey.toString('hex'), { mode: 0o600 });
  } catch (err) {
    console.warn('Warning writing .circle_key:', err);
  }
  cachedMasterKey = persistentKey;
  return cachedMasterKey;
}

function deriveSubKey(masterKey: Buffer, info: string): Buffer {
  return crypto.createHmac('sha256', masterKey).update(info).digest();
}

/**
 * Salted scrypt password hashing (`scrypt$<saltHex>$<hashHex>`).
 */
export function hashPassword(plainPassword: string): string {
  const password = String(plainPassword || '');
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export function isPasswordHashed(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('scrypt$') && value.split('$').length === 3;
}

/**
 * Constant-time password verification supporting scrypt hashes and legacy plaintext during migration.
 */
export function verifyPassword(
  plainPassword: string,
  user: { password_hash?: string; password?: string } | null | undefined
): { valid: boolean; needsMigration: boolean } {
  if (!user || typeof plainPassword !== 'string' || plainPassword.length === 0) {
    return { valid: false, needsMigration: false };
  }

  const storedHash = user.password_hash;
  if (typeof storedHash === 'string' && storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return { valid: false, needsMigration: false };
    const [, salt, hexDigest] = parts;
    try {
      const expected = Buffer.from(hexDigest, 'hex');
      const actual = crypto.scryptSync(plainPassword, salt, expected.length, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
      });
      if (expected.length !== actual.length) {
        return { valid: false, needsMigration: false };
      }
      return { valid: crypto.timingSafeEqual(expected, actual), needsMigration: false };
    } catch {
      return { valid: false, needsMigration: false };
    }
  }

  // Legacy plaintext migration fallback
  if (typeof user.password === 'string' && user.password.length > 0) {
    const a = Buffer.from(plainPassword, 'utf-8');
    const b = Buffer.from(user.password, 'utf-8');
    if (a.length !== b.length) return { valid: false, needsMigration: false };
    const valid = crypto.timingSafeEqual(a, b);
    return { valid, needsMigration: valid };
  }

  return { valid: false, needsMigration: false };
}

/**
 * Authenticated AES-256-GCM encryption (`aes256gcm$<ivHex>$<tagHex>$<cipherHex>`).
 */
export function encryptSecret(plaintext: string, masterKey: Buffer): string {
  const encKey = deriveSubKey(masterKey, 'circle-aes256gcm-v1');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes256gcm$${iv.toString('hex')}$${tag.toString('hex')}$${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string, masterKey: Buffer): string | null {
  if (!payload || typeof payload !== 'string') return null;
  const parts = payload.split('$');
  if (parts.length !== 4 || parts[0] !== 'aes256gcm') return null;
  try {
    const encKey = deriveSubKey(masterKey, 'circle-aes256gcm-v1');
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const data = Buffer.from(parts[3], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function digestSecret(value: string, masterKey: Buffer): string {
  const hmacKey = deriveSubKey(masterKey, 'circle-digest-v1');
  return crypto.createHmac('sha256', hmacKey).update(value).digest('hex');
}

export function verifySecretDigest(candidate: string, expectedHex: string, masterKey: Buffer): boolean {
  if (!candidate || !expectedHex) return false;
  try {
    const actual = Buffer.from(digestSecret(candidate, masterKey), 'hex');
    const expected = Buffer.from(expectedHex, 'hex');
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Signed HMAC-SHA256 session tokens (`base64url(payload).base64url(sig)`).
 */
export interface SessionTokenPayload {
  uid: string;
  tv: number;
  iat: number;
  exp: number;
}

export function signSessionToken(
  userId: string,
  tokenVersion: number,
  masterKey: Buffer,
  ttlMs: number = SESSION_TTL_MS
): string {
  const now = Date.now();
  const payload: SessionTokenPayload = {
    uid: userId,
    tv: Number(tokenVersion || 1),
    iat: now,
    exp: now + ttlMs,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const hmacKey = deriveSubKey(masterKey, 'circle-session-hmac-v1');
  const sig = crypto.createHmac('sha256', hmacKey).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null, masterKey: Buffer): SessionTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  try {
    const hmacKey = deriveSubKey(masterKey, 'circle-session-hmac-v1');
    const expectedSig = crypto.createHmac('sha256', hmacKey).update(body).digest();
    const actualSig = Buffer.from(sig, 'base64url');
    if (expectedSig.length !== actualSig.length || !crypto.timingSafeEqual(expectedSig, actualSig)) {
      return null;
    }
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionTokenPayload;
    if (!decoded || !decoded.uid || typeof decoded.exp !== 'number' || Date.now() > decoded.exp) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx <= 0) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  });
  return out;
}

/**
 * Per-account + IP brute-force login / recovery lockout guard.
 */
interface AttemptRecord {
  count: number;
  firstAttemptAt: number;
  lockedUntil: number;
}

const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const failedAttempts = new Map<string, AttemptRecord>();

export function getAuthThrottleStatus(key: string): { blocked: boolean; retryAfterSec: number } {
  const rec = failedAttempts.get(key);
  if (!rec) return { blocked: false, retryAfterSec: 0 };
  const now = Date.now();
  if (rec.lockedUntil > now) {
    return { blocked: true, retryAfterSec: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  if (now - rec.firstAttemptAt > ATTEMPT_WINDOW_MS) {
    failedAttempts.delete(key);
    return { blocked: false, retryAfterSec: 0 };
  }
  return { blocked: false, retryAfterSec: 0 };
}

export function recordFailedAuthAttempt(key: string): { locked: boolean; remainingAttempts: number; retryAfterSec: number } {
  const now = Date.now();
  const prev = failedAttempts.get(key);
  let rec: AttemptRecord;
  if (!prev || now - prev.firstAttemptAt > ATTEMPT_WINDOW_MS) {
    rec = { count: 1, firstAttemptAt: now, lockedUntil: 0 };
  } else {
    rec = { ...prev, count: prev.count + 1 };
  }
  if (rec.count >= MAX_FAILED_ATTEMPTS) {
    rec.lockedUntil = now + LOCKOUT_DURATION_MS;
    failedAttempts.set(key, rec);
    return { locked: true, remainingAttempts: 0, retryAfterSec: Math.ceil(LOCKOUT_DURATION_MS / 1000) };
  }
  failedAttempts.set(key, rec);
  return { locked: false, remainingAttempts: MAX_FAILED_ATTEMPTS - rec.count, retryAfterSec: 0 };
}

export function clearAuthAttempts(key: string): void {
  failedAttempts.delete(key);
}

/**
 * Evaluates password strength for validation and diagnostics.
 */
export function validatePasswordPolicy(password: string): { ok: boolean; detail?: string } {
  if (!password || typeof password !== 'string') {
    return { ok: false, detail: 'Password wajib diisi.' };
  }
  if (password.length < 6) {
    return { ok: false, detail: 'Password minimal 6 karakter untuk menjaga keamanan akun.' };
  }
  if (password.length > 128) {
    return { ok: false, detail: 'Password maksimal 128 karakter.' };
  }
  return { ok: true };
}
