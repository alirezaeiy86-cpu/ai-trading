# Architecture Document

**AI Trading Platform — Personal Algorithmic Trading System**
Version: 0.1.0 | Phase: 1 (Foundation)

---

## 1. System Overview

This is a private, single-user, AI-assisted algorithmic trading platform. It is not a SaaS
product. There is no multi-tenancy. Design decisions favour simplicity, low cost, and safety
over scalability.

### Core Design Principles

| Principle | Implementation |
|-----------|---------------|
| Risk first | Risk Engine has veto power over all trade decisions |
| AI-advisory | AI enhances decisions but cannot bypass Risk Engine |
| Paper before live | Paper trading is the default; live requires explicit opt-in |
| Transparency | Every decision is logged with full reasoning |
| Fault tolerance | Worker auto-reconnects; AI unavailability does not crash the system |
| Low cost | Free tiers prioritised; AI calls are selective and rate-limited |

---

## 2. Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  BROWSER                                                                 │
│  Next.js Dashboard (Vercel)                                              │
│  - TanStack Query for data fetching                                      │
│  - Zustand for local UI state                                            │
│  - Recharts for visualisation                                            │
│  - NO trading logic runs here                                            │
└───────────────────────────┬──────────────────────────────────────────────┘
                            │ HTTPS REST API
                            │ (JWT auth, rate limited)
┌───────────────────────────▼──────────────────────────────────────────────┐
│  Fastify API  (apps/api)                                                 │
│  - Authentication                                                        │
│  - Serves dashboard data from PostgreSQL                                 │
│  - Bot control commands (start/pause/resume/emergency-stop)              │
│  - Settings CRUD                                                         │
│  - Backtest trigger and results                                          │
│  - Does NOT run trading logic directly                                   │
└───────────┬───────────────────────────────────┬──────────────────────────┘
            │                                   │
            │ Redis (BullMQ commands)            │ PostgreSQL reads
            │                                   │
┌───────────▼───────────────────────────────────▼──────────────────────────┐
│  Trading Worker  (apps/worker)                                           │
│                                                                          │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐               │
│  │ Market Data │───▶│  Indicators  │───▶│ Strategy      │               │
│  │ Provider    │    │  Engine      │    │ Engine        │               │
│  └─────────────┘    └──────────────┘    └───────┬───────┘               │
│                                                 │ signal                 │
│                                        ┌────────▼──────────┐            │
│                                        │   AI Engine       │            │
│                                        │   (optional)      │            │
│                                        └────────┬──────────┘            │
│                                                 │ recommendation         │
│                                        ┌────────▼──────────┐            │
│                                        │   Risk Engine     │◀── VETO ─┐ │
│                                        │   (supreme)       │          │ │
│                                        └────────┬──────────┘          │ │
│                                                 │ approved             │ │
│                                        ┌────────▼──────────┐          │ │
│                                        │ Execution Provider│──────────┘ │
│                                        │ Paper | Live      │            │
│                                        └───────────────────┘            │
└──────────────────────────────────────────────────────────────────────────┘
            │                                   │
            │ BullMQ / Redis                    │ Prisma ORM
            ▼                                   ▼
    ┌───────────────┐                   ┌───────────────┐
    │     Redis     │                   │  PostgreSQL   │
    │  (Upstash)    │                   │  (Supabase /  │
    │               │                   │   Neon)       │
    └───────────────┘                   └───────────────┘
```

---

## 3. Package Dependency Graph

```
@trading/types        ← no internal deps (foundation)
@trading/config       ← zod only
@trading/logger       ← pino only

@trading/database     ← types, config, logger, prisma
@trading/market-data  ← types, config, logger
@trading/indicators   ← types
@trading/strategies   ← types, indicators
@trading/ai-engine    ← types, config, logger
@trading/risk-engine  ← types, config
@trading/execution    ← types, config, logger, database
@trading/backtesting  ← types, strategies, indicators, risk-engine, execution

apps/api              ← config, logger, types, database
apps/worker           ← config, logger, types, database, market-data,
                         indicators, strategies, ai-engine, risk-engine, execution
apps/web              ← types only (no server packages)
```

**Rules:**
- `apps/web` must never import server-only packages
- `packages/types` must never import other internal packages
- Circular dependencies are forbidden

---

## 4. Trading Pipeline (detailed)

### 4.1 Happy path — trade approved

```
1. BullMQ triggers market-data-update job
2. MarketDataProvider fetches candles for configured symbols/timeframes
3. Data stored in PostgreSQL (market_candles)
4. BullMQ triggers indicator-calculation job
5. IndicatorEngine calculates EMA, RSI, MACD, ATR, ADX etc.
6. BullMQ triggers strategy-analysis job
7. MarketRegimeDetector classifies: TRENDING / RANGING / etc.
8. Relevant strategies activated based on regime
9. Each strategy produces a StrategySignal with score 0-100
10. If no signal meets MIN_STRATEGY_SCORE → pipeline stops, decision logged
11. BullMQ triggers ai-analysis job (if AI_ENABLED=true)
12. AIRequestManager checks rate limits → calls AI provider
13. AI returns structured JSON recommendation
14. If AI confidence < MIN_AI_CONFIDENCE → pipeline stops, decision logged
15. BullMQ triggers risk-validation job
16. RiskEngine validates ALL constraints (see Risk Model doc)
17. If any constraint fails → REJECTED, decision logged
18. If all pass → ExecutionProvider.placeOrder()
19. Paper: simulated fill with realistic slippage/fees
20. Live: real exchange order + protective stop at exchange level
21. Position tracked in PostgreSQL
22. TradeDecisionLog written with full reasoning
23. Dashboard updated on next poll
```

### 4.2 AI unavailable path

```
... (steps 1-10 as above) ...
11. AI rate limited or unavailable
12. AI_UNAVAILABLE_MODE=NO_TRADE → pipeline stops, decision logged
    AI_UNAVAILABLE_MODE=RULE_BASED → skip AI, proceed to step 15
```

### 4.3 Emergency stop path

```
Dashboard → POST /bot/emergency-stop
API → writes EMERGENCY_STOP command to Redis
Worker → reads command on next heartbeat cycle
Worker → sets status=EMERGENCY_STOP
Worker → cancels pending/unfilled orders
Worker → stops opening new positions
Worker → continues monitoring existing positions
Worker → writes SystemEvent to PostgreSQL
Dashboard → shows 🛑 Emergency Stop banner
```

---

## 5. Job Queue Design

All worker processing is event-driven via BullMQ. No tight CPU loops.

| Job | Trigger | Concurrency |
|-----|---------|-------------|
| `market-data-update` | Every N minutes (configurable) | 1 |
| `indicator-calculation` | After market-data-update | 1 |
| `strategy-analysis` | After indicator-calculation | 1 |
| `ai-analysis` | After strategy finds opportunity | 1 |
| `risk-validation` | After AI analysis | 1 |
| `trade-execution` | After risk approval | 1 |
| `position-monitoring` | Every 60s | 1 |
| `daily-statistics` | Cron 00:00 UTC | 1 |
| `health-check` | Every 30s | 1 |

**Concurrency = 1** is intentional. Trading decisions must be sequential to prevent
duplicate order submission.

### Duplicate worker protection

Redis distributed lock: `trading:execution:lock` with TTL 30s.
Only one worker process can hold the execution lock at a time.
This prevents duplicate trades if the cloud platform starts a second instance during restart.

---

## 6. Database Design Principles

- PostgreSQL is the **single source of truth** for all financial records
- Redis is **ephemeral** — never store trade history or positions in Redis only
- All timestamps stored as UTC
- Soft deletes where appropriate (never hard-delete financial records)
- Migrations via Prisma migrate
- No raw SQL in application code — use Prisma client

---

## 7. Security Architecture

### Secrets management

```
Exchange API keys     → server env vars only, never in DB or logs
AI API key            → server env vars only
JWT secret            → server env vars only
Database password     → server env vars only
```

### API security layers

```
Request → Rate Limit → CORS → Helmet → JWT Auth → Route Handler
```

### Frontend security

- Dashboard only makes API calls to the Fastify backend
- No exchange secrets ever sent to the browser
- JWT tokens stored in httpOnly cookies (Phase 3)
- CSRF protection via SameSite cookies

---

## 8. Fault Tolerance

| Failure | Behaviour |
|---------|-----------|
| Market data API down | Retry with exponential backoff; skip analysis cycle; log warning |
| AI API rate limited | Honour `AI_UNAVAILABLE_MODE`; never crash |
| AI API down | Same as rate limited |
| Redis disconnect | BullMQ reconnects automatically; worker logs warning |
| PostgreSQL disconnect | Prisma reconnects; worker pauses until reconnected |
| Worker crash | Cloud platform restarts automatically (via health check) |
| Duplicate worker start | Redis distributed lock prevents duplicate trade execution |
| Stale market data | Never trade if candle data is older than 2× poll interval |

---

## 9. Cloud Deployment Target

### Infrastructure (minimal cost)

| Service | Provider | Cost |
|---------|----------|------|
| Dashboard | Vercel | Free |
| API + Worker | Fly.io / Railway / Render | ~$5–7/mo |
| PostgreSQL | Supabase / Neon | Free tier |
| Redis | Upstash | Free tier (pay-per-request) |
| AI API | Groq | Free tier (rate limited) |

### Fly.io deployment (recommended for API+Worker)

```bash
# Install flyctl
# fly launch --name trading-api
# fly launch --name trading-worker
# fly secrets set DATABASE_URL=... REDIS_URL=... JWT_SECRET=...
# fly deploy
```

The worker and API can share a single Fly.io machine to minimise cost, or run as separate
apps for independent scaling.

---

## 10. Architectural Decisions — Rationale

### Why not microservices?
Single user, minimal budget. Microservices add network latency, deployment complexity, and
cost without benefit at this scale. The monorepo with shared packages gives modularity
without the operational overhead.

### Why BullMQ over a cron job?
Cloud platforms (Vercel, Render serverless) kill processes after ~30s. A 5-minute cron job
is unreliable for a trading system that needs continuous position monitoring.
BullMQ with an always-on compute instance provides reliable, retryable, observable job
processing with built-in failure handling.

### Why is AI optional and rate-limited?
Free AI tiers have strict limits (e.g., 30 requests/minute on Groq free tier).
AI calling on every market tick would exhaust the daily quota in minutes.
AI is called only when the strategy engine identifies a high-quality opportunity,
preserving the quota for when it matters.

### Why PostgreSQL over a time-series database?
At a single-user scale with one to five trades per day, PostgreSQL is sufficient for
candle storage and querying. A time-series database (InfluxDB, TimescaleDB) would add
operational complexity without meaningful benefit. This decision can be revisited if
candle history exceeds 10 million rows.

### Why paper trading first?
Live trading carries real financial risk. The system must be validated over weeks of paper
trading before any live funds are risked. Paper trading uses the same Strategy Engine, Risk
Engine, and market data as live trading — only the execution provider changes.
