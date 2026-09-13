# Cloud Deployment Guide

Complete step-by-step guide to deploy the AI Trading Platform to production.

**Target stack (all free tiers):**

| Component | Service | Cost |
|-----------|---------|------|
| Dashboard | Vercel | Free |
| API | Fly.io | ~$3/mo (shared-cpu-1x, 256MB) |
| Worker | Fly.io | ~$3/mo (shared-cpu-1x, 256MB) |
| PostgreSQL | Supabase or Neon | Free tier |
| Redis | Upstash | Free tier (pay-per-request) |
| AI | Groq | Free tier |
| Exchange | Binance Testnet | Free |

**Estimated total: ~$6/month** (or free if within Fly free allowances)

---

## Prerequisites

```bash
# Install CLIs
npm install -g vercel
curl -L https://fly.io/install.sh | sh

# Authenticate
vercel login
fly auth login
```

---

## Step 1 — PostgreSQL (Supabase)

1. Create account at https://supabase.com
2. New project → choose region closest to your Fly region
3. Settings → Database → Copy "Connection string (URI)"
4. Save as `DATABASE_URL`

Run migrations:

```bash
# Set DATABASE_URL in your local .env first
pnpm --filter @trading/database db:migrate
pnpm --filter @trading/database db:seed
```

---

## Step 2 — Redis (Upstash)

1. Create account at https://upstash.com
2. Create Redis database → choose same region as Fly
3. Copy "Redis URL" (starts with `redis://...` or `rediss://...`)
4. Save as `REDIS_URL`

---

## Step 3 — Deploy API to Fly.io

```bash
# Create the app
fly apps create trading-api --org personal

# Set all secrets
fly secrets set \
  DATABASE_URL="postgresql://..." \
  REDIS_URL="redis://..." \
  JWT_SECRET="$(openssl rand -hex 32)" \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  DASHBOARD_PASSWORD="your-strong-password" \
  AI_PROVIDER="groq" \
  AI_API_KEY="your-groq-key" \
  AI_MODEL="llama-3.3-70b-versatile" \
  AI_ENABLED="true" \
  AI_MAX_REQUESTS_PER_MINUTE="3" \
  AI_MAX_REQUESTS_PER_DAY="50" \
  EXCHANGE_PROVIDER="binance" \
  EXCHANGE_TESTNET="true" \
  PAPER_TRADING="true" \
  LIVE_TRADING="false" \
  --app trading-api

# Deploy
fly deploy --config fly.api.toml --app trading-api

# Verify
curl https://trading-api.fly.dev/health
```

---

## Step 4 — Deploy Worker to Fly.io

```bash
fly apps create trading-worker --org personal

# Worker needs same secrets as API
fly secrets set \
  DATABASE_URL="postgresql://..." \
  REDIS_URL="redis://..." \
  AI_PROVIDER="groq" \
  AI_API_KEY="your-groq-key" \
  AI_MODEL="llama-3.3-70b-versatile" \
  AI_ENABLED="true" \
  AI_MAX_REQUESTS_PER_MINUTE="3" \
  AI_MAX_REQUESTS_PER_DAY="50" \
  AI_UNAVAILABLE_MODE="NO_TRADE" \
  EXCHANGE_PROVIDER="binance" \
  EXCHANGE_TESTNET="true" \
  PAPER_TRADING="true" \
  LIVE_TRADING="false" \
  WORKER_HEARTBEAT_INTERVAL_MS="15000" \
  MARKET_DATA_POLL_INTERVAL_MS="60000" \
  STRATEGY_CHECK_INTERVAL_MS="300000" \
  --app trading-worker

fly deploy --config fly.worker.toml --app trading-worker

# Check logs
fly logs --app trading-worker
```

---

## Step 5 — Deploy Dashboard to Vercel

```bash
cd apps/web

# Set environment variables in Vercel dashboard or CLI
vercel env add NEXT_PUBLIC_API_URL production
# Enter: https://trading-api.fly.dev

vercel --prod
```

Or connect your GitHub repo to Vercel for automatic deploys on push.

**Vercel environment variables to set:**
```
NEXT_PUBLIC_API_URL=https://trading-api.fly.dev
```

**Important:** Set `API_CORS_ORIGIN` in the API secrets to your Vercel URL:
```bash
fly secrets set API_CORS_ORIGIN="https://your-app.vercel.app" --app trading-api
```

---

## Step 6 — Verify deployment

```bash
# Health check
curl https://trading-api.fly.dev/health

# Expected:
# {
#   "status": "ok",
#   "services": {
#     "database": "ok",
#     "redis": "ok",
#     "worker": "ok"
#   }
# }
```

Open your Vercel URL → login with your `DASHBOARD_PASSWORD`.

Dashboard should show:
- 🟢 Worker Online
- 📋 PAPER TRADING

---

## Step 7 — Monitoring

```bash
# API logs
fly logs --app trading-api

# Worker logs
fly logs --app trading-worker

# Worker health
fly status --app trading-worker
```

The dashboard Monitoring page shows:
- System health (database, redis, worker)
- Worker heartbeat and uptime
- Event timeline
- AI usage per day

---

## Updating

```bash
# Deploy API update
fly deploy --config fly.api.toml --app trading-api

# Deploy Worker update
fly deploy --config fly.worker.toml --app trading-worker

# Dashboard updates automatically on Vercel (if GitHub connected)
```

---

## Cost optimisation tips

1. **Fly.io**: Use `shared-cpu-1x` with 256MB — sufficient for one user
2. **Supabase**: Free tier gives 500MB storage and 2GB bandwidth/month
3. **Upstash**: Pay-per-request — at 50 AI calls/day, Redis is nearly free
4. **Groq**: Free tier gives ~14,400 requests/day on LLaMA models
5. **AI calls**: System only calls AI when strategy finds a valid signal (not on every tick)

---

## Live Trading Checklist (Phase 14 only)

Before ever setting `LIVE_TRADING=true`:

- [ ] Minimum 4 weeks of paper trading validation
- [ ] Strategy win rate > 50% in paper trading
- [ ] Maximum drawdown < 5% in paper trading
- [ ] All risk limits tested and verified
- [ ] Emergency stop tested
- [ ] Exchange API keys created with **trade permissions only** (no withdrawals)
- [ ] API keys set as Fly secrets (never in code or .env files)
- [ ] Start with minimum position size
- [ ] Monitor continuously for first 48 hours

**Never** enable live trading based on backtest results alone.
