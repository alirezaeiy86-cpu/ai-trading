# Phase 4 — Market Data Setup Guide

## What was built

### `packages/market-data`

| File | Description |
|------|-------------|
| `types/provider.interface.ts` | `MarketDataProvider` interface + error types |
| `providers/binance.provider.ts` | Binance REST + WebSocket (testnet supported) |
| `providers/mock.provider.ts` | Deterministic synthetic data for tests |
| `market-data.service.ts` | Orchestrator — seed, subscribe, poll, stale check |
| `provider.factory.ts` | Creates provider from `EXCHANGE_PROVIDER` env var |
| `__tests__/mock-provider.test.ts` | 12 unit tests for MockProvider |

### New API endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /market/health` | Freshness check for all symbol/timeframe pairs |
| `GET /market/candles?symbol=&timeframe=&limit=` | Candles from DB |

### Worker changes

- `TradingWorker` now starts `MarketDataService` on boot
- `market-data-update` job calls `pollCandles()` as safety net
- `health-check` job logs stale pair warnings
- `HeartbeatService` tracks `currentJob` name

---

## Configuration

```env
# Use Binance testnet (no real funds)
EXCHANGE_PROVIDER=binance
EXCHANGE_TESTNET=true
EXCHANGE_API_KEY=        # not required for public market data
EXCHANGE_API_SECRET=     # not required for public market data

# Use mock provider for local dev without internet
EXCHANGE_PROVIDER=mock

# Polling intervals
MARKET_DATA_POLL_INTERVAL_MS=60000    # 1 minute poll fallback
STRATEGY_CHECK_INTERVAL_MS=300000     # 5 minute strategy cycle
```

---

## Provider abstraction

```
MarketDataProvider (interface)
    ├── BinanceProvider    EXCHANGE_PROVIDER=binance
    └── MockProvider       EXCHANGE_PROVIDER=mock

# Adding a new exchange (e.g. Kraken):
# 1. Create packages/market-data/src/providers/kraken.provider.ts
# 2. Implement MarketDataProvider interface
# 3. Add case to provider.factory.ts
# Done — zero other changes required
```

---

## Stale data protection

```
getCandles() always checks:
  latestCandleTime > now - staleThresholdMs

If stale → throws MarketDataError(STALE_DATA)
Worker logs warning + skips analysis cycle
Strategy engine never trades on stale data
```

---

## Running tests

```bash
pnpm --filter @trading/market-data test
```

Expected output:
```
PASS src/__tests__/mock-provider.test.ts
  MockProvider
    ✓ reports healthy after connect
    ✓ reports unhealthy after disconnect
    ✓ returns a ticker for BTCUSDT
    ✓ returns a ticker for ETHUSDT
    ✓ throws for unknown symbol
    ✓ returns a positive current price
    ✓ returns the requested number of candles
    ✓ candles have correct structure
    ✓ candles are in ascending order (oldest first)
    ✓ high >= open, close and low <= open, close
    ✓ supports timeframe 1m / 5m / 15m / 1h / 4h / 1d
    ✓ emits candles via subscription and unsubscribe works
```

---

## Next: Phase 5 — Indicators + Strategy Engine

Phase 5 implements:
- EMA, RSI, MACD, ATR, ADX, Bollinger Bands
- MarketRegimeDetector
- StrategyEngine with 4 strategy families
- Signal scoring and persistence
