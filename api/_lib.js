import { Redis } from '@upstash/redis';
import crypto from 'node:crypto';

export const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const INDEX_KEY = 'sig:index';
export const sigKey = (id) => `sig:${id}`;

const VILLAGES = [
  'Näs Focksta', 'Vångelsta', 'Stora Bärsta', 'Lilla Bärsta',
  'Näs-Högby', 'Näs-Edeby', 'Annan', 'Other',
];

/** What someone can offer besides money. Anything else is dropped. */
const HELP = ['maskin', 'kroppsarbete', 'planering', 'ansokningar', 'material', 'fika'];

/** Mandate answers. */
const TRISTATE = ['ja', 'nej', 'vet_ej'];

/** Strip control chars, collapse whitespace, hard-cap length. */
export function clean(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value);
}

export function hashIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : String(fwd || '')).split(',')[0].trim() || 'unknown';
  const salt = process.env.IP_SALT || 'cykelstigen';
  return crypto.createHash('sha256').update(salt + ip).digest('hex').slice(0, 16);
}

/** Max `limit` writes per `windowSec` per hashed IP. */
export async function rateLimit(ipHash, limit = 5, windowSec = 3600) {
  const key = `rl:${ipHash}:${Math.floor(Date.now() / (windowSec * 1000))}`;
  const hits = await redis.incr(key);
  if (hits === 1) await redis.expire(key, windowSec);
  return hits <= limit;
}

export async function verifyTurnstile(token, ipHeader) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, skipped: false };
  const body = new URLSearchParams({ secret, response: token });
  if (ipHeader) body.set('remoteip', ipHeader);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const json = await res.json();
    return { ok: json.success === true, skipped: false };
  } catch {
    return { ok: false, skipped: false };
  }
}

export function normalizeVillage(value) {
  const v = clean(value, 30);
  return VILLAGES.includes(v) ? v : 'Annan';
}

export function normalizeHelp(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => clean(v, 20)).filter((v) => HELP.includes(v)).slice(0, HELP.length);
}

export function normalizeTristate(value) {
  const v = clean(value, 10);
  return TRISTATE.includes(v) ? v : 'vet_ej';
}

/**
 * Normalise a fastighetsbeteckning for counting distinct properties:
 * "uppsala näs-bärsta 4:3" and "UPPSALA NÄS-BÄRSTA 4:3" are one property.
 */
export function propertyFingerprint(record) {
  const designation = clean(record.propertyId, 60).toUpperCase().replace(/\s+/g, ' ');
  if (designation) return 'F:' + designation;
  const address = clean(record.address, 120).toUpperCase().replace(/\s+/g, ' ');
  if (address) return 'A:' + address;
  return '';
}

/**
 * What the public page receives. Address and fastighetsbeteckning are public
 * information in Sweden and are shown by default — a named list of properties
 * is the point of the exercise. A signer can opt out per signature, which
 * matters for anyone with skyddade personuppgifter.
 *
 * Email is never public, whatever the setting.
 */
export function toPublic(record) {
  const out = {
    id: record.id,
    n: record.first,
    l: record.lastInitial,
    v: record.village,
    h: record.household,
    p: record.pledge,
    hrs: record.hours,
    help: record.helpWith,
    mandate: record.supportsAssociation,
    m: record.comment || '',
    t: record.createdAt.slice(0, 10),
  };
  if (record.showAddress !== false) {
    out.a = record.address || '';
    out.f = record.propertyId || '';
  }
  return out;
}

export async function readAll() {
  const ids = await redis.zrange(INDEX_KEY, 0, -1);
  if (!ids.length) return [];
  const records = await Promise.all(ids.map((id) => redis.get(sigKey(id))));
  return records.filter(Boolean);
}

export function requireAdmin(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  const header = req.headers.authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
