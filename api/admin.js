import { redis, INDEX_KEY, sigKey, readAll, requireAdmin } from './_lib.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (req.method === 'GET') {
    const all = await readAll();
    const csv = toCsv(all);
    if (req.query.format === 'csv') {
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', 'attachment; filename="cykelstigen-underskrifter.csv"');
      return res.status(200).send(csv);
    }
    return res.status(200).json({ signatures: all.slice().reverse() });
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { id, action } = body;
    if (!id || !action) return res.status(400).json({ error: 'id_and_action_required' });

    const record = await redis.get(sigKey(id));
    if (!record) return res.status(404).json({ error: 'not_found' });

    if (action === 'hide' || action === 'show') {
      record.hidden = action === 'hide';
      await redis.set(sigKey(id), record);
      return res.status(200).json({ ok: true, hidden: record.hidden });
    }
    if (action === 'clear_comment') {
      record.comment = '';
      await redis.set(sigKey(id), record);
      return res.status(200).json({ ok: true });
    }
    if (action === 'delete') {
      await redis.del(sigKey(id));
      await redis.zrem(INDEX_KEY, id);
      return res.status(200).json({ ok: true, deleted: true });
    }
    return res.status(400).json({ error: 'unknown_action' });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method_not_allowed' });
}

function toCsv(rows) {
  const head = [
    'createdAt', 'first', 'lastName', 'village', 'address', 'propertyId',
    'showAddress', 'household', 'pledge', 'hours', 'helpWith', 'member', 'supportsAssociation',
    'email', 'consent', 'hidden', 'comment',
  ];
  const esc = (v) => `"${String(Array.isArray(v) ? v.join(' ') : (v ?? '')).replace(/"/g, '""')}"`;
  return [head.join(',')]
    .concat(rows.map((r) => head.map((k) => esc(r[k])).join(',')))
    .join('\n');
}
