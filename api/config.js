export default function handler(req, res) {
  res.setHeader('cache-control', 'public, s-maxage=300');
  return res.status(200).json({
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
    contactEmail: process.env.CONTACT_EMAIL || 'yoed.anise@gmail.com',
    // What the path itself is estimated to cost to build.
    buildCost: int(process.env.BUILD_COST_SEK, 170000),
    // What the campaign is raising in total, including the match.
    goal: int(process.env.GOAL_SEK, 320000),
    // 1:1 match, capped.
    matchCap: int(process.env.MATCH_CAP_SEK, 160000),
    matcherName: process.env.MATCHER_NAME || 'Yoed Anise',
  });
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
