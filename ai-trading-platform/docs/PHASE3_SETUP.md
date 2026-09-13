# Phase 3 — Setup Guide

## What was built in Phase 3

### API (apps/api)

| Route | Auth | Description |
|-------|------|-------------|
| `GET  /health` | ❌ | DB + worker liveness check |
| `POST /auth/login` | ❌ | Password → signed httpOnly cookie |
| `POST /auth/logout` | ❌ | Clear session cookie |
| `GET  /auth/me` | ✅ | Check session validity |
| `GET  /dashboard` | ✅ | Full dashboard summary |
| `GET  /positions` | ✅ | Open positions |
| `GET  /positions/history` | ✅ | Closed trades |
| `GET  /orders` | ✅ | Recent orders |
| `GET  /signals` | ✅ | Strategy signals |
| `GET  /signals/decisions` | ✅ | Trade decision audit log |
| `GET  /signals/ai` | ✅ | AI analyses |
| `GET  /settings` | ✅ | Current risk settings |
| `PATCH /settings` | ✅ | Update risk settings |
| `GET  /bot/status` | ✅ | Worker liveness |
| `POST /bot/start` | ✅ | Request worker start |
| `POST /bot/pause` | ✅ | Pause worker |
| `POST /bot/resume` | ✅ | Resume worker |
| `POST /bot/emergency-stop` | ✅ | 🛑 Emergency stop |
| `GET  /logs` | ✅ | System event log |
| `GET  /risk/status` | ✅ | Live risk snapshot |
| `GET  /statistics/daily` | ✅ | Daily P&L history |
| `GET  /statistics/summary` | ✅ | All-time stats |
| `GET  /system/status` | ✅ | System info |

### Frontend (apps/web)

| Page | Description |
|------|-------------|
| `/login` | Password login — httpOnly cookie session |
| `/` | Main dashboard — balances, P&L, positions, worker status, events |
| `/positions` | Open + closed position tables |
| `/signals` | Trade decision audit log with full reasoning |
| `/settings` | All risk controls with live save |
| `/logs` | System event log with level filter |

### Auth architecture

```
POST /auth/login { password }
      ↓
  bcrypt.compare(password, hash)   ← hash stored in memory at startup
      ↓ success
  JWT signed → Set-Cookie: trading_session (httpOnly, signed, SameSite=Strict)
      ↓
  All protected routes: onRequest: [fastify.authenticate]
      ↓
  fastify.authenticate calls request.jwtVerify()
  → reads cookie automatically via @fastify/jwt cookie option
```

No user table. No registration. Single password from `DASHBOARD_PASSWORD` env var.

---

## Running Phase 3

### 1. Start infrastructure
```bash
docker compose up -d postgres redis
```

### 2. Run migrations + seed
```bash
pnpm --filter @trading/database db:migrate:dev
pnpm --filter @trading/database db:seed
```

### 3. Create `.env` from `.env.example`
Minimum required:
```env
DATABASE_URL="postgresql://trading:trading@localhost:5432/trading_db"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="any-long-random-string-at-least-32-chars"
SESSION_SECRET="another-long-random-string-at-least-32-chars"
DASHBOARD_PASSWORD="your-secure-password"
NEXT_PUBLIC_API_URL="http://localhost:3001"
```

### 4. Start all three apps
```bash
# Terminal 1
pnpm --filter @trading/api dev

# Terminal 2
pnpm --filter @trading/worker dev

# Terminal 3
pnpm --filter @trading/web dev
```

### 5. Verify
```bash
# Health check
curl http://localhost:3001/health

# Login
curl -c cookies.txt -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"your-secure-password"}'

# Dashboard (with cookie)
curl -b cookies.txt http://localhost:3001/dashboard
```

Open http://localhost:3000 — you'll see the login page, then the dashboard.

---

## Next: Phase 4 — Market Data

Phase 4 implements:
- `MarketDataProvider` interface
- Binance testnet WebSocket + REST provider
- Candle fetching, storage, stale-data detection
- Worker integration — real market data flowing into the database
