# AI Trading Platform

A personal AI-assisted algorithmic trading platform. Paper-trading first, live-trading capable.

> ⚠️ No profitability guarantee. Validate extensively before any live trading.

## Quick Start

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, REDIS_URL, JWT_SECRET, SESSION_SECRET, DASHBOARD_PASSWORD
docker compose up -d
npm run db:migrate --workspace=packages/database
npm run db:seed    --workspace=packages/database
npm run dev
# → http://localhost:3000
```

## Phases Completed

| Phase | Description |
|-------|-------------|
| ✅ 1  | Monorepo, Next.js, Fastify, Worker, Docker |
| ✅ 2  | PostgreSQL (16 tables), Prisma, repositories |
| ✅ 3  | JWT auth, 24 API endpoints, 6-page dashboard |
| ✅ 4  | Binance REST+WebSocket market data |
| ✅ 5  | 12 indicators, regime detector, 5 strategies |
| ✅ 6  | Risk Engine (20 validations, position sizing) |
| ✅ 7  | Paper execution (slippage+fees), position monitor |
| ✅ 8  | Backtesting (no look-ahead), equity curve, metrics |
| ✅ 9  | AI Engine (Groq/OpenAI/Anthropic/Ollama) + rate limiting |
| ✅ 10 | Redis pub/sub bot control, distributed lock |
| ✅ 11 | Monitoring page, health checks, event timeline |
| ✅ 12 | Fly.io + Vercel deploy, GitHub Actions CI |
| ⬜ 13 | Paper trading validation (4+ weeks) |
| ⬜ 14 | Live trading (after validation ONLY) |

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Risk Model](docs/RISK_MODEL.md)
- [Deployment](docs/DEPLOYMENT.md)
