#!/usr/bin/env bash
# One-shot deploy for the cykelstigen site.
#   ./deploy.sh
# Re-running it is safe: it skips anything already set up.
set -euo pipefail

cd "$(dirname "$0")"

say() { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }
warn() { printf '\n\033[1;33m!  %s\033[0m\n' "$1"; }

command -v node >/dev/null || { echo "Install Node 20+ first: https://nodejs.org"; exit 1; }
command -v vercel >/dev/null || { say "Installing the Vercel CLI"; npm i -g vercel; }

if ! vercel whoami >/dev/null 2>&1; then
  say "Logging in to Vercel (a browser window will open)"
  vercel login
fi

if [ ! -f .vercel/project.json ]; then
  say "Linking this folder to a Vercel project"
  vercel link
fi

# --- secrets -----------------------------------------------------------------
existing_env="$(vercel env ls production 2>/dev/null || true)"

if ! grep -q 'ADMIN_TOKEN' <<<"$existing_env"; then
  ADMIN_TOKEN="$(openssl rand -hex 32)"
  printf '%s' "$ADMIN_TOKEN" | vercel env add ADMIN_TOKEN production >/dev/null
  say "ADMIN_TOKEN created — this is your password for /admin, save it now:"
  printf '\n    %s\n\n' "$ADMIN_TOKEN"
else
  warn "ADMIN_TOKEN already set — leaving it alone (vercel env rm ADMIN_TOKEN production to rotate)"
fi

if ! grep -q 'IP_SALT' <<<"$existing_env"; then
  printf '%s' "$(openssl rand -hex 16)" | vercel env add IP_SALT production >/dev/null
  say "IP_SALT created"
fi

# --- storage check -----------------------------------------------------------
if ! grep -q 'UPSTASH_REDIS_REST_URL' <<<"$existing_env"; then
  warn "No Upstash Redis connected yet. The site will deploy, but nothing can be saved."
  cat <<'TXT'

   In the Vercel dashboard for this project:
     Storage  →  Create Database  →  Upstash Redis  →  Connect Project

   That injects UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for you.
   Then run this script again to redeploy.

TXT
fi

say "Deploying to production"
vercel deploy --prod

say "Done."
cat <<'TXT'

Next, when you are ready:
  • Captcha — dash.cloudflare.com → Turnstile → Add site, then:
        vercel env add TURNSTILE_SITE_KEY production
        vercel env add TURNSTILE_SECRET_KEY production
        ./deploy.sh
  • Moderation — visit /admin on the live site and paste the ADMIN_TOKEN above.

TXT
