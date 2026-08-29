import crypto from 'node:crypto';
import {
  redis, INDEX_KEY, sigKey, clean, clampInt, isEmail, hashIp, rateLimit,
  verifyTurnstile, normalizeVillage, normalizeHelp, normalizeTristate,
  propertyFingerprint, toPublic, readAll,
} from './_lib.js';

const matchCap = () => Number.parseInt(process.env.MATCH_CAP_SEK, 10) || 160000;

export default async function handler(req, res) {
  if (req.method === 'GET') return list(res);
  if (req.method === 'POST') return create(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method_not_allowed' });
}

export function summarise(records, cap) {
  const properties = new Set();
  const villages = new Set();
  let households = 0, people = 0, pledged = 0, hours = 0, mandate = 0, helpers = 0;

  for (const r of records) {
    households += 1;
    people += r.household || 0;
    pledged += r.pledge || 0;
    hours += r.hours || 0;
    if (r.supportsAssociation === 'ja') mandate += 1;
    if ((r.hours || 0) > 0 || (r.helpWith || []).length) helpers += 1;
    const fp = propertyFingerprint(r);
    if (fp) properties.add(fp);
    if (r.village) villages.add(r.village);
  }

  const matched = Math.min(pledged, cap);
  return {
    households,
    people,
    properties: properties.size,
    villages: villages.size,
    pledged,
    matched,
    total: pledged + matched,
    matchRemaining: Math.max(0, cap - pledged),
    hours,
    helpers,
    mandate,
  };
}

async function list(res) {
  try {
    const all = await readAll();
    const visible = all.filter((r) => !r.hidden);
    res.setHeader('cache-control', 'public, s-maxage=10, stale-while-revalidate=60');
    return res.status(200).json({
      totals: summarise(visible, matchCap()),
      signatures: visible.map(toPublic),
    });
  } catch (err) {
    console.error('list failed', err);
    return res.status(500).json({ error: 'storage_unavailable' });
  }
}

async function create(req, res) {
  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {};

  // Honeypot: real people never fill a hidden field.
  if (clean(body.website, 10)) return res.status(200).json({ ok: true, ignored: true });

  const first = clean(body.first, 40);
  const last = clean(body.last, 40);
  if (!first || !last) return res.status(400).json({ error: 'name_required' });

  const email = clean(body.email, 120).toLowerCase();
  const consent = body.consent === true || body.consent === 'true';
  if (email && !isEmail(email)) return res.status(400).json({ error: 'email_invalid' });
  if (email && !consent) return res.status(400).json({ error: 'consent_required' });

  const forwarded = req.headers['x-forwarded-for'];
  const rawIp = (Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '')).split(',')[0].trim();

  const turnstile = await verifyTurnstile(body.turnstileToken, rawIp);
  if (!turnstile.ok) return res.status(400).json({ error: 'captcha_failed' });

  const ipHash = hashIp(req);
  if (!(await rateLimit(ipHash, 5, 3600))) return res.status(429).json({ error: 'rate_limited' });

  const record = {
    id: crypto.randomUUID(),
    first,
    lastInitial: last.slice(0, 1).toUpperCase(),
    lastName: last,
    village: normalizeVillage(body.village),
    address: clean(body.address, 120),
    propertyId: clean(body.propertyId, 60),
    showAddress: body.showAddress !== false,
    household: clampInt(body.household, 1, 12, 1),
    pledge: clampInt(body.pledge, 0, 200000, 0),
    hours: clampInt(body.hours, 0, 500, 0),
    helpWith: normalizeHelp(body.helpWith),
    supportsAssociation: normalizeTristate(body.supportsAssociation),
    comment: clean(body.comment, 240),
    email: consent ? email : '',
    consent: Boolean(email) && consent,
    hidden: false,
    ipHash,
    createdAt: new Date().toISOString(),
  };

  try {
    await redis.set(sigKey(record.id), record);
    await redis.zadd(INDEX_KEY, { score: Date.now(), member: record.id });
  } catch (err) {
    console.error('write failed', err);
    return res.status(500).json({ error: 'storage_unavailable' });
  }

  // Recompute rather than increment, so the match cap is always applied correctly.
  let totals = null;
  try {
    totals = summarise((await readAll()).filter((r) => !r.hidden), matchCap());
  } catch { /* the signature is saved; the page can refetch */ }

  return res.status(201).json({ ok: true, signature: toPublic(record), totals });
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return {}; }
}
