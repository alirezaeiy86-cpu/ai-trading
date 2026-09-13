-- =============================================================================
-- INITIAL MIGRATION
-- Creates all tables for the AI Trading Platform.
-- All timestamps stored as TIMESTAMPTZ (UTC).
-- =============================================================================

-- ── Trading Settings (singleton) ─────────────────────────────────────────────
CREATE TABLE "trading_settings" (
    "id"                        TEXT NOT NULL DEFAULT 'singleton',
    "createdAt"                 TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                 TIMESTAMPTZ NOT NULL,
    "paperTrading"              BOOLEAN NOT NULL DEFAULT true,
    "liveTrading"               BOOLEAN NOT NULL DEFAULT false,
    "riskPerTradePercent"       DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "minRiskReward"             DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "maxDailyLossPercent"       DOUBLE PRECISION NOT NULL DEFAULT 0.03,
    "maxWeeklyLossPercent"      DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "maxDrawdownPercent"        DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "maxTradesPerDay"           INTEGER NOT NULL DEFAULT 5,
    "maxOpenPositions"          INTEGER NOT NULL DEFAULT 3,
    "maxLeverage"               INTEGER NOT NULL DEFAULT 1,
    "minStrategyScore"          INTEGER NOT NULL DEFAULT 80,
    "minAiConfidence"           DOUBLE PRECISION NOT NULL DEFAULT 0.80,
    "longEnabled"               BOOLEAN NOT NULL DEFAULT true,
    "shortEnabled"              BOOLEAN NOT NULL DEFAULT false,
    "stopLossMode"              TEXT NOT NULL DEFAULT 'structure',
    "takeProfitMode"            TEXT NOT NULL DEFAULT 'rr_ratio',
    "trailingStopEnabled"       BOOLEAN NOT NULL DEFAULT false,
    "breakEvenEnabled"          BOOLEAN NOT NULL DEFAULT false,
    "tradingHoursStart"         TEXT NOT NULL DEFAULT '00:00',
    "tradingHoursEnd"           TEXT NOT NULL DEFAULT '23:59',
    "cooldownAfterTradeMs"      INTEGER NOT NULL DEFAULT 300000,
    "cooldownAfterLossMs"       INTEGER NOT NULL DEFAULT 1800000,
    "allowedSymbols"            TEXT[] NOT NULL DEFAULT '{}',
    "allowedTimeframes"         TEXT[] NOT NULL DEFAULT '{"15m","1h","4h"}',
    "aiEnabled"                 BOOLEAN NOT NULL DEFAULT true,
    "aiUnavailableMode"         TEXT NOT NULL DEFAULT 'NO_TRADE',
    "dailyProfitTargetPercent"  DOUBLE PRECISION,
    "dailyProfitTargetAmount"   DOUBLE PRECISION,
    CONSTRAINT "trading_settings_pkey" PRIMARY KEY ("id")
);

-- ── Paper Account ─────────────────────────────────────────────────────────────
CREATE TABLE "paper_accounts" (
    "id"              TEXT NOT NULL,
    "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMPTZ NOT NULL,
    "initialBalance"  DOUBLE PRECISION NOT NULL,
    "currentBalance"  DOUBLE PRECISION NOT NULL,
    "equity"          DOUBLE PRECISION NOT NULL,
    "highWaterMark"   DOUBLE PRECISION NOT NULL,
    "currency"        TEXT NOT NULL DEFAULT 'USDT',
    CONSTRAINT "paper_accounts_pkey" PRIMARY KEY ("id")
);

-- ── Symbols ───────────────────────────────────────────────────────────────────
CREATE TABLE "symbols" (
    "id"           TEXT NOT NULL,
    "symbol"       TEXT NOT NULL,
    "baseAsset"    TEXT NOT NULL,
    "quoteAsset"   TEXT NOT NULL,
    "exchange"     TEXT NOT NULL DEFAULT 'binance',
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "minOrderSize" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tickSize"     DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "stepSize"     DOUBLE PRECISION NOT NULL DEFAULT 0.00001,
    "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "symbols_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "symbols_symbol_key" ON "symbols"("symbol");

-- ── Market Candles ────────────────────────────────────────────────────────────
CREATE TABLE "market_candles" (
    "id"        TEXT NOT NULL,
    "symbol"    TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "openTime"  TIMESTAMPTZ NOT NULL,
    "closeTime" TIMESTAMPTZ NOT NULL,
    "open"      DOUBLE PRECISION NOT NULL,
    "high"      DOUBLE PRECISION NOT NULL,
    "low"       DOUBLE PRECISION NOT NULL,
    "close"     DOUBLE PRECISION NOT NULL,
    "volume"    DOUBLE PRECISION NOT NULL,
    "isClosed"  BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "market_candles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "market_candles_symbol_timeframe_openTime_key"
    ON "market_candles"("symbol", "timeframe", "openTime");
CREATE INDEX "market_candles_symbol_timeframe_openTime_idx"
    ON "market_candles"("symbol", "timeframe", "openTime" DESC);

-- ── Strategies ────────────────────────────────────────────────────────────────
CREATE TABLE "strategies" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "config"      JSONB NOT NULL DEFAULT '{}',
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMPTZ NOT NULL,
    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "strategies_name_key" ON "strategies"("name");

-- ── Strategy Signals ──────────────────────────────────────────────────────────
CREATE TABLE "strategy_signals" (
    "id"           TEXT NOT NULL,
    "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "strategyId"   TEXT NOT NULL,
    "symbol"       TEXT NOT NULL,
    "timeframe"    TEXT NOT NULL,
    "direction"    TEXT NOT NULL,
    "score"        INTEGER NOT NULL,
    "confidence"   DOUBLE PRECISION NOT NULL,
    "entryMin"     DOUBLE PRECISION NOT NULL,
    "entryMax"     DOUBLE PRECISION NOT NULL,
    "stopLoss"     DOUBLE PRECISION NOT NULL,
    "takeProfit"   DOUBLE PRECISION NOT NULL,
    "riskReward"   DOUBLE PRECISION NOT NULL,
    "marketRegime" TEXT NOT NULL,
    "reasons"      TEXT[] NOT NULL,
    CONSTRAINT "strategy_signals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "strategy_signals_strategyId_fkey"
        FOREIGN KEY ("strategyId") REFERENCES "strategies"("id")
);
CREATE INDEX "strategy_signals_symbol_createdAt_idx" ON "strategy_signals"("symbol", "createdAt" DESC);
CREATE INDEX "strategy_signals_createdAt_idx" ON "strategy_signals"("createdAt" DESC);

-- ── AI Predictions ────────────────────────────────────────────────────────────
CREATE TABLE "ai_predictions" (
    "id"           TEXT NOT NULL,
    "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "symbol"       TEXT NOT NULL,
    "timeframe"    TEXT NOT NULL,
    "modelUsed"    TEXT NOT NULL,
    "provider"     TEXT NOT NULL,
    "decision"     TEXT NOT NULL,
    "confidence"   DOUBLE PRECISION NOT NULL,
    "marketRegime" TEXT NOT NULL,
    "entry"        DOUBLE PRECISION,
    "stopLoss"     DOUBLE PRECISION,
    "takeProfit"   DOUBLE PRECISION,
    "reasons"      TEXT[] NOT NULL,
    "rawResponse"  JSONB,
    "latencyMs"    INTEGER NOT NULL,
    "tokensUsed"   INTEGER,
    "promptTokens" INTEGER,
    CONSTRAINT "ai_predictions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_predictions_symbol_createdAt_idx" ON "ai_predictions"("symbol", "createdAt" DESC);

-- ── AI Usage Logs ─────────────────────────────────────────────────────────────
CREATE TABLE "ai_usage_logs" (
    "id"             TEXT NOT NULL,
    "date"           TEXT NOT NULL,
    "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider"       TEXT NOT NULL,
    "model"          TEXT NOT NULL,
    "requestsCount"  INTEGER NOT NULL DEFAULT 0,
    "errorsCount"    INTEGER NOT NULL DEFAULT 0,
    "rateLimitHits"  INTEGER NOT NULL DEFAULT 0,
    "totalLatencyMs" INTEGER NOT NULL DEFAULT 0,
    "totalTokens"    INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_usage_logs_date_provider_model_key"
    ON "ai_usage_logs"("date", "provider", "model");

-- ── Orders ────────────────────────────────────────────────────────────────────
CREATE TABLE "orders" (
    "id"              TEXT NOT NULL,
    "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMPTZ NOT NULL,
    "clientOrderId"   TEXT NOT NULL,
    "exchangeOrderId" TEXT,
    "symbol"          TEXT NOT NULL,
    "side"            TEXT NOT NULL,
    "type"            TEXT NOT NULL,
    "status"          TEXT NOT NULL,
    "quantity"        DOUBLE PRECISION NOT NULL,
    "price"           DOUBLE PRECISION,
    "stopPrice"       DOUBLE PRECISION,
    "filledQuantity"  DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgFillPrice"    DOUBLE PRECISION,
    "fees"            DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeCurrency"     TEXT NOT NULL DEFAULT 'USDT',
    "filledAt"        TIMESTAMPTZ,
    "isPaper"         BOOLEAN NOT NULL DEFAULT true,
    "positionId"      TEXT,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "orders_clientOrderId_key" ON "orders"("clientOrderId");
CREATE INDEX "orders_symbol_createdAt_idx" ON "orders"("symbol", "createdAt" DESC);
CREATE INDEX "orders_status_idx" ON "orders"("status");
CREATE INDEX "orders_positionId_idx" ON "orders"("positionId");

-- ── Positions ─────────────────────────────────────────────────────────────────
CREATE TABLE "positions" (
    "id"                   TEXT NOT NULL,
    "createdAt"            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMPTZ NOT NULL,
    "symbol"               TEXT NOT NULL,
    "side"                 TEXT NOT NULL,
    "status"               TEXT NOT NULL,
    "entryPrice"           DOUBLE PRECISION NOT NULL,
    "quantity"             DOUBLE PRECISION NOT NULL,
    "stopLoss"             DOUBLE PRECISION NOT NULL,
    "takeProfit"           DOUBLE PRECISION NOT NULL,
    "currentPrice"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unrealisedPnl"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "realisedPnl"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fees"                 DOUBLE PRECISION NOT NULL DEFAULT 0,
    "openedAt"             TIMESTAMPTZ NOT NULL,
    "closedAt"             TIMESTAMPTZ,
    "closeReason"          TEXT,
    "isPaper"              BOOLEAN NOT NULL DEFAULT true,
    "strategyScore"        INTEGER,
    "aiConfidence"         DOUBLE PRECISION,
    "marketRegimeAtEntry"  TEXT,
    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "positions_symbol_status_idx" ON "positions"("symbol", "status");
CREATE INDEX "positions_status_openedAt_idx" ON "positions"("status", "openedAt" DESC);

-- Add FK after positions table exists
ALTER TABLE "orders"
    ADD CONSTRAINT "orders_positionId_fkey"
    FOREIGN KEY ("positionId") REFERENCES "positions"("id");

-- ── Trade Decision Logs ───────────────────────────────────────────────────────
CREATE TABLE "trade_decision_logs" (
    "id"                    TEXT NOT NULL,
    "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "symbol"                TEXT NOT NULL,
    "outcome"               TEXT NOT NULL,
    "strategyScore"         INTEGER NOT NULL,
    "requiredStrategyScore" INTEGER NOT NULL,
    "strategyReasons"       TEXT[] NOT NULL,
    "signalId"              TEXT,
    "aiDecision"            TEXT,
    "aiConfidence"          DOUBLE PRECISION,
    "requiredAiConfidence"  DOUBLE PRECISION NOT NULL,
    "aiReasons"             TEXT[] NOT NULL,
    "riskDecision"          TEXT,
    "riskRejectionReasons"  TEXT[] NOT NULL,
    "riskReward"            DOUBLE PRECISION,
    "requiredRiskReward"    DOUBLE PRECISION NOT NULL,
    "marketRegime"          TEXT NOT NULL,
    "finalReason"           TEXT NOT NULL,
    "positionId"            TEXT,
    CONSTRAINT "trade_decision_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "trade_decision_logs_positionId_key" UNIQUE ("positionId"),
    CONSTRAINT "trade_decision_logs_signalId_fkey"
        FOREIGN KEY ("signalId") REFERENCES "strategy_signals"("id"),
    CONSTRAINT "trade_decision_logs_positionId_fkey"
        FOREIGN KEY ("positionId") REFERENCES "positions"("id")
);
CREATE INDEX "trade_decision_logs_symbol_createdAt_idx"
    ON "trade_decision_logs"("symbol", "createdAt" DESC);
CREATE INDEX "trade_decision_logs_outcome_createdAt_idx"
    ON "trade_decision_logs"("outcome", "createdAt" DESC);

-- ── Daily Statistics ──────────────────────────────────────────────────────────
CREATE TABLE "daily_statistics" (
    "id"               TEXT NOT NULL,
    "date"             TEXT NOT NULL,
    "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMPTZ NOT NULL,
    "startingBalance"  DOUBLE PRECISION NOT NULL,
    "endingBalance"    DOUBLE PRECISION NOT NULL,
    "pnl"              DOUBLE PRECISION NOT NULL,
    "pnlPercent"       DOUBLE PRECISION NOT NULL,
    "totalTrades"      INTEGER NOT NULL DEFAULT 0,
    "winningTrades"    INTEGER NOT NULL DEFAULT 0,
    "losingTrades"     INTEGER NOT NULL DEFAULT 0,
    "winRate"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgWin"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgLoss"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "profitFactor"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxDrawdown"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalFees"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aiRequestsUsed"   INTEGER NOT NULL DEFAULT 0,
    "isPaper"          BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "daily_statistics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "daily_statistics_date_key" ON "daily_statistics"("date");

-- ── Risk Events ───────────────────────────────────────────────────────────────
CREATE TABLE "risk_events" (
    "id"         TEXT NOT NULL,
    "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType"  TEXT NOT NULL,
    "symbol"     TEXT,
    "details"    JSONB NOT NULL DEFAULT '{}',
    "resolved"   BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMPTZ,
    CONSTRAINT "risk_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "risk_events_createdAt_idx" ON "risk_events"("createdAt" DESC);
CREATE INDEX "risk_events_eventType_resolved_idx" ON "risk_events"("eventType", "resolved");

-- ── System Events ─────────────────────────────────────────────────────────────
CREATE TABLE "system_events" (
    "id"        TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type"      TEXT NOT NULL,
    "level"     TEXT NOT NULL,
    "message"   TEXT NOT NULL,
    "data"      JSONB,
    CONSTRAINT "system_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "system_events_type_createdAt_idx" ON "system_events"("type", "createdAt" DESC);
CREATE INDEX "system_events_level_createdAt_idx" ON "system_events"("level", "createdAt" DESC);
CREATE INDEX "system_events_createdAt_idx" ON "system_events"("createdAt" DESC);

-- ── Worker Heartbeats ─────────────────────────────────────────────────────────
CREATE TABLE "worker_heartbeats" (
    "id"            TEXT NOT NULL,
    "workerId"      TEXT NOT NULL,
    "workerVersion" TEXT NOT NULL,
    "status"        TEXT NOT NULL,
    "tradingMode"   TEXT NOT NULL,
    "currentJob"    TEXT,
    "uptimeSeconds" INTEGER NOT NULL,
    "lastSeenAt"    TIMESTAMPTZ NOT NULL,
    "memoryUsageMb" INTEGER NOT NULL,
    "queuedJobs"    INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "worker_heartbeats_workerId_key" ON "worker_heartbeats"("workerId");
CREATE INDEX "worker_heartbeats_lastSeenAt_idx" ON "worker_heartbeats"("lastSeenAt" DESC);

-- ── Backtest Runs ─────────────────────────────────────────────────────────────
CREATE TABLE "backtest_runs" (
    "id"             TEXT NOT NULL,
    "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMPTZ NOT NULL,
    "strategyName"   TEXT NOT NULL,
    "symbol"         TEXT NOT NULL,
    "timeframe"      TEXT NOT NULL,
    "startDate"      TIMESTAMPTZ NOT NULL,
    "endDate"        TIMESTAMPTZ NOT NULL,
    "initialBalance" DOUBLE PRECISION NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'PENDING',
    "error"          TEXT,
    "riskConfig"     JSONB NOT NULL,
    "totalTrades"    INTEGER,
    "winningTrades"  INTEGER,
    "losingTrades"   INTEGER,
    "winRate"        DOUBLE PRECISION,
    "netPnl"         DOUBLE PRECISION,
    "netPnlPercent"  DOUBLE PRECISION,
    "profitFactor"   DOUBLE PRECISION,
    "avgR"           DOUBLE PRECISION,
    "maxDrawdown"    DOUBLE PRECISION,
    "maxDrawdownPct" DOUBLE PRECISION,
    "largestWin"     DOUBLE PRECISION,
    "largestLoss"    DOUBLE PRECISION,
    "avgTrade"       DOUBLE PRECISION,
    "totalFees"      DOUBLE PRECISION,
    "tradeList"      JSONB,
    "equityCurve"    JSONB,
    CONSTRAINT "backtest_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "backtest_runs_createdAt_idx" ON "backtest_runs"("createdAt" DESC);
CREATE INDEX "backtest_runs_status_idx" ON "backtest_runs"("status");
