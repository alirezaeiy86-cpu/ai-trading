// =============================================================================
// API CLIENT
// Typed fetch wrapper. All dashboard data flows through here.
// Runs only in the browser — no server secrets.
// =============================================================================

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include', // send httpOnly cookie
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const json = (await res.json()) as {
    success: boolean;
    data?: T;
    error?: { code: string; message: string };
  };

  if (!json.success || !res.ok) {
    throw new ApiError(
      json.error?.code ?? 'UNKNOWN',
      json.error?.message ?? 'Request failed',
      res.status,
    );
  }

  return json.data as T;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (password: string) =>
    request<{ message: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ message: string }>('/auth/logout', { method: 'POST' }),
  me: () => request<{ authenticated: boolean }>('/auth/me'),
};

// ── Dashboard ─────────────────────────────────────────────────────────────────
export type DashboardData = {
  balance: number;
  equity: number;
  availableBalance: number;
  highWaterMark: number;
  currency: string;
  isPaper: boolean;
  todayPnl: number;
  todayPnlPercent: number;
  drawdownPercent: number;
  tradesToday: number;
  winningToday: number;
  losingToday: number;
  winRateToday: number;
  allTimePnl: number;
  allTimeTrades: number;
  allTimeWins: number;
  allTimeLosses: number;
  allTimeFees: number;
  openPositions: OpenPosition[];
  worker: WorkerInfo;
  recentEvents: RecentEvent[];
};

export type OpenPosition = {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  unrealisedPnl: number;
  openedAt: string;
};

export type WorkerInfo = {
  status: 'online' | 'offline' | 'stale';
  lastHeartbeat: string | null;
  uptimeSeconds: number;
  tradingMode: 'PAPER' | 'LIVE';
  memoryMb: number;
};

export type RecentEvent = {
  id: string;
  type: string;
  level: string;
  message: string;
  createdAt: string;
};

export const dashboardApi = {
  get: () => request<DashboardData>('/dashboard'),
};

// ── Risk ──────────────────────────────────────────────────────────────────────
export type RiskStatus = {
  balance: number;
  equity: number;
  highWaterMark: number;
  todayRealisedPnl: number;
  todayUnrealisedPnl: number;
  todayTotalPnl: number;
  weekPnl: number;
  currentDrawdownPct: number;
  maxDrawdownPct: number;
  drawdownBreached: boolean;
  dailyLossPct: number;
  maxDailyLossPct: number;
  dailyLossBreached: boolean;
  tradesToday: number;
  maxTradesPerDay: number;
  tradesLimitReached: boolean;
  openPositionsCount: number;
  maxOpenPositions: number;
  positionsLimitReached: boolean;
  canTrade: boolean;
};

export const riskApi = {
  getStatus: () => request<RiskStatus>('/risk/status'),
};

// ── Bot control ───────────────────────────────────────────────────────────────
export type BotStatus = {
  workerAlive: boolean;
  workerStatus: string;
  tradingMode: string;
  lastHeartbeat: string | null;
  uptimeSeconds: number;
  memoryMb: number;
  queuedJobs: number;
};

export const botApi = {
  getStatus:     () => request<BotStatus>('/bot/status'),
  start:         (reason?: string) => request('/bot/start',         { method: 'POST', body: JSON.stringify({ reason }) }),
  pause:         (reason?: string) => request('/bot/pause',         { method: 'POST', body: JSON.stringify({ reason }) }),
  resume:        (reason?: string) => request('/bot/resume',        { method: 'POST', body: JSON.stringify({ reason }) }),
  emergencyStop: (reason?: string) => request('/bot/emergency-stop',{ method: 'POST', body: JSON.stringify({ reason }) }),
};

// ── Positions ─────────────────────────────────────────────────────────────────
export const positionsApi = {
  getOpen:    () => request<OpenPosition[]>('/positions'),
  getHistory: (limit = 50, offset = 0) =>
    request<{ items: OpenPosition[]; total: number; hasMore: boolean }>(
      `/positions/history?limit=${limit}&offset=${offset}`,
    ),
};

// ── Signals ───────────────────────────────────────────────────────────────────
export type DecisionLog = {
  id: string;
  symbol: string;
  outcome: 'APPROVED' | 'REJECTED' | 'NO_TRADE_AI_UNAVAILABLE';
  strategyScore: number;
  requiredStrategyScore: number;
  strategyReasons: string[];
  aiDecision: string | null;
  aiConfidence: number | null;
  riskDecision: string | null;
  riskRejectionReasons: string[];
  riskReward: number | null;
  marketRegime: string;
  finalReason: string;
  createdAt: string;
};

export const signalsApi = {
  getDecisions: (limit = 50) => request<DecisionLog[]>(`/signals/decisions?limit=${limit}`),
  getAI:        (limit = 20) => request<unknown[]>(`/signals/ai?limit=${limit}`),
};

// ── Settings ──────────────────────────────────────────────────────────────────
export type TradingSettings = {
  riskPerTradePercent: number;
  minRiskReward: number;
  maxDailyLossPercent: number;
  maxWeeklyLossPercent: number;
  maxDrawdownPercent: number;
  maxTradesPerDay: number;
  maxOpenPositions: number;
  maxLeverage: number;
  minStrategyScore: number;
  minAiConfidence: number;
  longEnabled: boolean;
  shortEnabled: boolean;
  aiEnabled: boolean;
  aiUnavailableMode: string;
  tradingHoursStart: string;
  tradingHoursEnd: string;
  allowedSymbols: string[];
  allowedTimeframes: string[];
  paperTrading: boolean;
};

export const settingsApi = {
  get:    () => request<TradingSettings>('/settings'),
  update: (data: Partial<TradingSettings>) =>
    request<TradingSettings>('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
};

// ── Logs ──────────────────────────────────────────────────────────────────────
export type SystemEvent = {
  id: string;
  type: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data: unknown;
  createdAt: string;
};

export const logsApi = {
  get: (limit = 100, level?: string) =>
    request<SystemEvent[]>(`/logs?limit=${limit}${level ? `&level=${level}` : ''}`),
};

// ── Statistics ────────────────────────────────────────────────────────────────
export type DailyStat = {
  date: string;
  pnl: number;
  pnlPercent: number;
  totalTrades: number;
  winningTrades: number;
  winRate: number;
  maxDrawdown: number;
};

export const statisticsApi = {
  daily: (days = 30) => request<DailyStat[]>(`/statistics/daily?days=${days}`),
};

// ── AI ────────────────────────────────────────────────────────────────────────
export type AIStatusData = {
  enabled:            boolean;
  provider:           string;
  model:              string;
  unavailableMode:    string;
  requestsToday:      number;
  maxPerDay:          number;
  remainingToday:     number;
  errorsToday:        number;
  rateLimitHitsToday: number;
};

export const aiApi = {
  getStatus:   () => request<AIStatusData>('/ai/status'),
  getAnalyses: (limit = 20) => request<unknown[]>(`/ai/analyses?limit=${limit}`),
  getUsage:    (days = 7)  => request<{ daily: unknown[]; totals: unknown }>(`/ai/usage?days=${days}`),
};

export { ApiError };
