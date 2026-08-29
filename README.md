# Cykelstigen Näs Focksta–Stora Bärsta

Campaign site for the 490 m path between Näs Focksta and Stora Bärsta. Static
page plus three serverless functions, storing signatures, conditional pledges
and volunteer hours in Upstash Redis. No framework, no build step.

The page's first ask is not the landowner — it is the village's existing ideell
förening. It collects the evidence a board needs to take the project on: how
many households and **distinct properties** back it, how much money and labour
is committed, and an explicit yes/no on giving the association the mandate.

```
api/_lib.js          shared helpers: redis client, sanitising, rate limit, turnstile, auth
api/config.js        public runtime config (turnstile site key, contact, budget)
api/signatures.js    GET public list + totals · POST new signature
api/admin.js         GET all rows / CSV · POST hide, show, clear_comment, delete
public/index.html    the campaign page (SV/EN)
public/admin.html    moderation panel, token-gated
public/route.jpg     proposed alignment, page 8 of the June 2026 deck
public/overview.jpg  landscape overview, page 7
```

## Deploy

One command, from the unzipped folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1   # Windows
```
```bash
./deploy.sh                                             # macOS / Linux / Git Bash
```

It installs the CLI if missing, logs you in, links the project, generates
`ADMIN_TOKEN` and `IP_SALT` (printing the admin token once), sets
`ASSOCIATION_NAME`, and deploys to production. Or by hand:

```bash
npm i -g vercel
vercel                 # link + first deploy
vercel --prod
```

Framework preset: **Other**. Vercel serves `public/` as the site root and turns
each file in `api/` into a function automatically. `api/_lib.js` starts with an
underscore so it stays a module rather than becoming a route.

### 1. Storage — Upstash Redis

In the Vercel dashboard: **Storage → Create Database → Upstash Redis → Connect
Project**. This injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
for you. Nothing else to configure — `Redis.fromEnv()` picks them up.

Free tier is 10,000 commands/day. A signature costs 2 writes and a page load 1
read plus one per row, so a village-sized list will not come close.

### 2. Environment variables

Copy `.env.example`. The two that matter:

```bash
ADMIN_TOKEN=$(openssl rand -hex 32)   # guards /admin
IP_SALT=$(openssl rand -hex 16)       # hashes visitor IPs before storage
```

Set `ASSOCIATION_NAME` to the förening's real name and it replaces every
"byföreningen" on the page. The money figures are all environment variables too
— `GOAL_SEK`, `MATCH_CAP_SEK`, `MATCHER_NAME`, `BUILD_COST_SEK` — so changing
the target is one variable and a redeploy, not an edit.

Add them under **Settings → Environment Variables** for Production, Preview and
Development, then redeploy. Without `ADMIN_TOKEN` the admin API refuses every
request, which is the safe default.

### 3. Captcha — Cloudflare Turnstile (optional but recommended)

At `dash.cloudflare.com → Turnstile → Add site`, add your Vercel domain, then set
`TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. The widget appears in the form
automatically once the site key is present; leave both blank and the page runs
without a captcha.

Turnstile is free, needs no cookie banner, and does not profile visitors — which
is why it is here instead of reCAPTCHA.

## Spam defences, in order

1. **Honeypot** — a hidden `website` field. Anything that fills it gets a cheerful
   "thanks" and is silently discarded.
2. **Turnstile** — verified server-side; a missing or bad token is rejected once
   `TURNSTILE_SECRET_KEY` is set.
3. **Rate limit** — 5 submissions per hashed IP per hour, counted in Redis.
4. **Sanitising** — control characters stripped, whitespace collapsed, every field
   length-capped, village restricted to a known list, pledge clamped to
   0–200,000, and all output HTML-escaped in the browser.

Comments publish immediately, as you asked. `/admin` is where you take one down:
**Dölj** hides a row from the public page and the counters while keeping the
record, **Rensa text** removes only the comment and keeps the signature, and
**Radera** deletes it permanently.

## What the form collects

| Field | Public? | Why it is there |
|---|---|---|
| First name, surname | initial only | attribution |
| Hamlet, household size | yes | headcount |
| **Street address** | yes, opt-out | maps the signature to a real home |
| **Fastighetsbeteckning** | yes, opt-out | the unit that counts legally — a landowner and Lantmäteriet reason about *fastigheter*, not people |
| Pledge in SEK | yes | funding, matched 1:1 |
| Volunteer hours + what they can help with | yes | doing the work in-house drops the build from ~150,000 to 70–90,000 kr |
| Member of the förening? | no | tells the board how much of this is its own membership |
| Backs the association taking it on? | aggregate | the mandate count, which is the actual vote |
| Email + consent tick | no | contact when pledges fall due |
| Comment | yes | shown as a pull quote |

Distinct properties are counted from the fastighetsbeteckning where given and
the address otherwise, normalised for case and spacing, so one household
signing twice does not inflate the number.

## Moderation panel

Visit `/admin`, paste the `ADMIN_TOKEN`. It is kept in `sessionStorage`, so it
survives a refresh and is gone when the tab closes. The panel shows every row
including email addresses, and **Ladda ner CSV** exports the lot — that is the
file to attach to a Leader Upplandsbygd application or hand to UAF.

## Data protection

Addresses and fastighetsbeteckningar are public information in Sweden and are
shown on the page by default — a named list of properties is the document worth
producing. Each signer can opt out with one checkbox (`showAddress: false`), and
the public API then omits both fields for that row. That opt-out is not
decoration: anyone with skyddade personuppgifter must be able to sign without
appearing.

**Email addresses are never public**, whatever the address setting — they exist
only behind the token-gated admin route, and only with an explicit consent tick.
Visitor IPs are salted and hashed before they touch storage; only the hash is
kept, and only for rate limiting.

The footer states the controller and how to ask for removal. Removal is
**Radera** in the admin panel.

## Changing the content

Everything is in `public/index.html`. Text is bilingual through paired
attributes:

```html
<h2 data-sv="Rubrik på svenska" data-en="Heading in English"></h2>
```

The element's content is filled from whichever attribute matches the active
language, so edit the attributes, never the text between the tags. `{ASSOC}`
inside either attribute is replaced with `ASSOCIATION_NAME` at render time.

Nothing about the money is hard-coded — `GOAL_SEK`, `MATCH_CAP_SEK`,
`MATCHER_NAME` and `BUILD_COST_SEK` drive the counters, the progress bar and the
match panel. The one place a number is written into the page is the cost table
in the "Målet" section, which is prose and needs editing by hand if the
line items change.
