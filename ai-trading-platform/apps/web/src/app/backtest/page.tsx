'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { AppShell }    from '@/components/layout/AppShell';
import { Card, CardHeader, CardTitle, CardBody, Badge, Button } from '@/components/ui/index';
import { formatCurrency, formatPercent, pnlColor } from '@/lib/format';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BacktestRun {
  id:             string;
  strategyName:   string;
  symbol:         string;
  timeframe:      string;
  startDate:      string;
  endDate:        string;
  initialBalance: number;
  status:         'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  netPnl:         number | null;
  netPnlPercent:  number | null;
  winRate:        number | null;
  totalTrades:    number | null;
  maxDrawdownPct: number | null;
  createdAt:      string;
  tradeList?:     Array<{ pnl: number; closeReason: string }>;
  equityCurve?:   Array<{ date: string; equity: number; drawdown: number }>;
}

async function authFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res  = await fetch(`${API}${path}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const json = await res.json() as { success: boolean; data: unknown };
  if (!json.success) throw new Error(JSON.stringify(json));
  return json.data;
}

// ── Config form ───────────────────────────────────────────────────────────────

interface FormState {
  strategyName:        string;
  symbol:              string;
  timeframe:           string;
  startDate:           string;
  endDate:             string;
  initialBalance:      number;
  riskPerTradePercent: number;
  minRiskReward:       number;
  minStrategyScore:    number;
}

function BacktestForm({ onRun }: { onRun: (id: string) => void }): React.ReactElement {
  const [form, setForm] = useState<FormState>({
    strategyName:        'ema_trend_follow',
    symbol:              'BTCUSDT',
    timeframe:           '1h',
    startDate:           '2024-01-01T00:00:00Z',
    endDate:             '2024-06-30T00:00:00Z',
    initialBalance:      10000,
    riskPerTradePercent: 1,
    minRiskReward:       2,
    minStrategyScore:    60,
  });

  const { mutate, isPending, error } = useMutation({
    mutationFn: async () => {
      const body = {
        ...form,
        riskPerTradePercent: form.riskPerTradePercent / 100,
      };
      const data = await authFetch('/backtest/run', { method: 'POST', body: JSON.stringify(body) }) as { id: string };
      return data.id;
    },
    onSuccess: (id) => onRun(id),
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]): void =>
    setForm((p) => ({ ...p, [k]: v }));

  const strategies = [
    { value: 'ema_trend_follow',    label: 'EMA Trend Following' },
    { value: 'rsi_momentum',        label: 'RSI Momentum' },
    { value: 'volatility_breakout', label: 'Volatility Breakout' },
    { value: 'market_structure',    label: 'Market Structure' },
    { value: 'mean_reversion',      label: 'Mean Reversion' },
  ];

  return (
    <Card>
      <CardHeader><CardTitle>New Backtest</CardTitle></CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Strategy */}
          <div>
            <label className="mb-1 block text-xs text-slate-400">Strategy</label>
            <select
              value={form.strategyName}
              onChange={(e) => set('strategyName', e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              {strategies.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Symbol */}
          <div>
            <label className="mb-1 block text-xs text-slate-400">Symbol</label>
            <select
              value={form.symbol}
              onChange={(e) => set('symbol', e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              <option value="BTCUSDT">BTCUSDT</option>
              <option value="ETHUSDT">ETHUSDT</option>
            </select>
          </div>

          {/* Timeframe */}
          <div>
            <label className="mb-1 block text-xs text-slate-400">Timeframe</label>
            <select
              value={form.timeframe}
              onChange={(e) => set('timeframe', e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              {['15m','1h','4h'].map((tf) => <option key={tf} value={tf}>{tf}</option>)}
            </select>
          </div>

          {/* Start date */}
          <div>
            <label className="mb-1 block text-xs text-slate-400">Start Date (UTC)</label>
            <input
              type="date"
              value={form.startDate.slice(0, 10)}
              onChange={(e) => set('startDate', `${e.target.value}T00:00:00Z`)}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* End date */}
          <div>
            <label className="mb-1 block text-xs text-slate-400">End Date (UTC)</label>
            <input
              type="date"
              value={form.endDate.slice(0, 10)}
              onChange={(e) => set('endDate', `${e.target.value}T23:59:59Z`)}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Capital */}
          <div>
            <label className="mb-1 block text-xs text-slate-400">Initial Balance ($)</label>
            <input
              type="number"
              value={form.initialBalance}
              onChange={(e) => set('initialBalance', parseFloat(e.target.value))}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Risk per trade */}
          <div>
            <label className="mb-1 block text-xs text-slate-400">Risk Per Trade (%)</label>
            <input
              type="number"
              step="0.1" min="0.1" max="5"
              value={form.riskPerTradePercent}
              onChange={(e) => set('riskPerTradePercent', parseFloat(e.target.value))}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Min R:R */}
          <div>
            <label className="mb-1 block text-xs text-slate-400">Min Risk/Reward</label>
            <input
              type="number"
              step="0.1" min="1" max="10"
              value={form.minRiskReward}
              onChange={(e) => set('minRiskReward', parseFloat(e.target.value))}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Min strategy score */}
          <div>
            <label className="mb-1 block text-xs text-slate-400">Min Strategy Score (0–100)</label>
            <input
              type="number"
              step="1" min="0" max="100"
              value={form.minStrategyScore}
              onChange={(e) => set('minStrategyScore', parseInt(e.target.value))}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-400">
            Error: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        )}

        <div className="mt-5 flex items-center gap-3">
          <Button onClick={() => mutate()} disabled={isPending}>
            {isPending ? '⏳ Starting…' : '▶ Run Backtest'}
          </Button>
          <p className="text-xs text-slate-500">
            Results appear when complete. Large date ranges may take a minute.
          </p>
        </div>

        <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-400">
          ⚠️ Backtest results do not guarantee future performance. Validate on out-of-sample data.
        </div>
      </CardBody>
    </Card>
  );
}

// ── Result detail ─────────────────────────────────────────────────────────────

function BacktestDetail({ id }: { id: string }): React.ReactElement {
  const { data: run, isLoading } = useQuery({
    queryKey: ['backtest', id],
    queryFn:  () => authFetch(`/backtest/${id}`) as Promise<BacktestRun>,
    refetchInterval: (q) => q.state.data?.status === 'RUNNING' ? 3_000 : false,
  });

  if (isLoading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (!run) return <p className="text-sm text-red-400">Not found</p>;

  if (run.status === 'RUNNING') {
    return (
      <Card>
        <CardBody>
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <p className="text-sm text-slate-300">Backtest running… results will appear automatically.</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (run.status === 'FAILED') {
    return (
      <Card>
        <CardBody>
          <p className="text-red-400 font-semibold">Backtest failed</p>
          <p className="mt-1 text-sm text-slate-400">{run.netPnl ?? 'Unknown error'}</p>
        </CardBody>
      </Card>
    );
  }

  const pnlTrend = (run.netPnl ?? 0) > 0 ? 'up' : (run.netPnl ?? 0) < 0 ? 'down' : 'neutral';
  const curve    = run.equityCurve ?? [];

  return (
    <div className="space-y-5">
      {/* Summary metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Net P&L',      value: formatCurrency(run.netPnl ?? 0),                        color: pnlColor(run.netPnl ?? 0) },
          { label: 'Return',       value: formatPercent((run.netPnlPercent ?? 0) * 100),            color: pnlColor(run.netPnl ?? 0) },
          { label: 'Win Rate',     value: `${((run.winRate ?? 0) * 100).toFixed(1)}%`,             color: 'text-slate-100' },
          { label: 'Total Trades', value: String(run.totalTrades ?? 0),                            color: 'text-slate-100' },
          { label: 'Max Drawdown', value: formatPercent((run.maxDrawdownPct ?? 0) * 100),           color: 'text-red-400' },
          { label: 'Strategy',     value: run.strategyName,                                        color: 'text-blue-400' },
          { label: 'Period',       value: `${run.startDate.slice(0,10)} → ${run.endDate.slice(0,10)}`, color: 'text-slate-300' },
          { label: 'Capital',      value: formatCurrency(run.initialBalance),                       color: 'text-slate-300' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-slate-700 bg-slate-800 p-4">
            <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">{label}</p>
            <p className={`text-base font-bold truncate ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Equity curve chart */}
      {curve.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Equity Curve</CardTitle></CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={curve}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v: string) => v.slice(5, 10)}
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  width={60}
                />
                <Tooltip
                  formatter={(v: number) => [formatCurrency(v), 'Equity']}
                  labelFormatter={(l: string) => l.slice(0, 10)}
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <ReferenceLine y={run.initialBalance} stroke="#475569" strokeDasharray="4 4" />
                <Line
                  type="monotone" dataKey="equity"
                  stroke="#3b82f6" strokeWidth={2} dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ── Run list ──────────────────────────────────────────────────────────────────

function RunList({ onSelect, selected }: { onSelect: (id: string) => void; selected: string | null }): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['backtests'],
    queryFn:  () => authFetch('/backtest?limit=20') as Promise<BacktestRun[]>,
    refetchInterval: 5_000,
  });

  if (isLoading) return <p className="text-sm text-slate-400">Loading runs…</p>;
  if (!data || data.length === 0) return <p className="text-sm text-slate-500">No backtest runs yet.</p>;

  return (
    <Card>
      <CardHeader><CardTitle>Recent Runs</CardTitle></CardHeader>
      <CardBody className="p-0">
        <div className="divide-y divide-slate-700/50">
          {data.map((run) => {
            const statusColor: Record<string, string> = {
              COMPLETED: 'text-green-400',
              RUNNING:   'text-blue-400',
              FAILED:    'text-red-400',
              PENDING:   'text-slate-400',
            };
            return (
              <button
                key={run.id}
                onClick={() => onSelect(run.id)}
                className={`w-full px-5 py-3 text-left transition hover:bg-slate-700/30 ${selected === run.id ? 'bg-slate-700/40' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-200">{run.strategyName}</p>
                    <p className="text-xs text-slate-500">
                      {run.symbol} · {run.timeframe} · {run.startDate.slice(0,10)}→{run.endDate.slice(0,10)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xs font-bold ${statusColor[run.status] ?? 'text-slate-400'}`}>
                      {run.status}
                    </p>
                    {run.netPnl !== null && (
                      <p className={`text-xs ${pnlColor(run.netPnl)}`}>
                        {formatCurrency(run.netPnl)}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BacktestPage(): React.ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Backtesting</h1>
          <p className="text-sm text-slate-400">
            Test strategies on historical data. No look-ahead bias. Fills at next bar open.
          </p>
        </div>

        <BacktestForm onRun={(id) => setSelectedId(id)} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <RunList onSelect={setSelectedId} selected={selectedId} />
          </div>
          <div className="lg:col-span-2">
            {selectedId
              ? <BacktestDetail id={selectedId} />
              : (
                <Card>
                  <CardBody>
                    <p className="py-8 text-center text-sm text-slate-500">
                      Select a run to view results, or start a new backtest above.
                    </p>
                  </CardBody>
                </Card>
              )
            }
          </div>
        </div>
      </div>
    </AppShell>
  );
}
