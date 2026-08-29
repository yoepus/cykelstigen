# Deploy the cykelstigen site to Vercel, from Windows PowerShell.
#
#   cd <the unzipped folder>
#   powershell -ExecutionPolicy Bypass -File .\deploy.ps1
#
# Re-running is safe: it skips anything already set up.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Say  ($m) { Write-Host "`n> $m" -ForegroundColor Cyan }
function Warn ($m) { Write-Host "`n! $m" -ForegroundColor Yellow }

function New-Secret ([int]$Bytes) {
  $buf = [byte[]]::new($Bytes)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buf) } finally { $rng.Dispose() }
  -join ($buf | ForEach-Object { $_.ToString('x2') })
}

# --- prerequisites -----------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node 20+ is required. Install it from https://nodejs.org and run this again." -ForegroundColor Red
  exit 1
}

if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
  Say "Installing the Vercel CLI"
  npm install -g vercel
  if ($LASTEXITCODE -ne 0) { throw "npm install -g vercel failed" }
}

# --- login and link ----------------------------------------------------------
$null = vercel whoami 2>$null
if ($LASTEXITCODE -ne 0) {
  Say "Logging in to Vercel (a browser window will open)"
  vercel login
  if ($LASTEXITCODE -ne 0) { throw "vercel login failed" }
}

if (-not (Test-Path '.vercel\project.json')) {
  Say "Linking this folder to a Vercel project"
  vercel link
  if ($LASTEXITCODE -ne 0) { throw "vercel link failed" }
}

# --- secrets -----------------------------------------------------------------
$existing = (vercel env ls production 2>&1 | Out-String)

if ($existing -notmatch 'ADMIN_TOKEN') {
  $adminToken = New-Secret 32
  $adminToken | vercel env add ADMIN_TOKEN production | Out-Null
  Say "ADMIN_TOKEN created. This is your password for /admin — save it now:"
  Write-Host "`n    $adminToken`n" -ForegroundColor Green
} else {
  Warn "ADMIN_TOKEN already set, leaving it alone (vercel env rm ADMIN_TOKEN production to rotate)"
}

if ($existing -notmatch 'IP_SALT') {
  (New-Secret 16) | vercel env add IP_SALT production | Out-Null
  Say "IP_SALT created"
}

if ($existing -notmatch 'ASSOCIATION_NAME') {
  'Näs Focksta Vänner' | vercel env add ASSOCIATION_NAME production | Out-Null
  Say "ASSOCIATION_NAME set to 'Näs Focksta Vänner'"
}

# --- storage -----------------------------------------------------------------
if ($existing -notmatch 'UPSTASH_REDIS_REST_URL') {
  Warn "No Upstash Redis connected yet. The site will deploy, but nothing can be saved."
  Write-Host @"

   In the Vercel dashboard for this project:
     Storage  ->  Create Database  ->  Upstash Redis  ->  Connect Project

   That injects UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for you.
   Then run this script again to redeploy.

"@
}

# --- deploy ------------------------------------------------------------------
Say "Deploying to production"
vercel deploy --prod
if ($LASTEXITCODE -ne 0) { throw "vercel deploy failed" }

Say "Done."
Write-Host @"

Next, when you are ready:
  * Captcha - dash.cloudflare.com -> Turnstile -> Add site, then:
        vercel env add TURNSTILE_SITE_KEY production
        vercel env add TURNSTILE_SECRET_KEY production
        .\deploy.ps1
  * Moderation - visit /admin on the live site and paste the ADMIN_TOKEN above.

"@
