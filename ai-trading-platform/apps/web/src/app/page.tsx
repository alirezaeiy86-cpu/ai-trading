'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardApi, botApi } from '@/lib/api';
import { AppShell } from '@/components/layout/AppShell';
import { StatCard, Card, CardHeader, CardTitle, CardBody, Badge, Button } from '@/components/ui/index';
import { EmergencyStopButton } from '@/components/ui/EmergencyStop';
import { MarketDataHealth }    from '@/components/dashboard/MarketDataHealth';
import { RiskStatusWidget }    from '@/components/dashboard/RiskStatus';
import { AIStatusWidget }      from '@/components/dashboard/AIStatus';
import { formatCurrency, formatPercent, pnlColor, timeAgo, formatUptime } from '@/lib/format';

export default function DashboardPage(): React.ReactElement {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.get,
    refetchInterval: 15_000,
  });

  const pauseMutation = useMutation({
    mutationFn: () => botApi.pause(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bot-status'] }),
  });

  const resumeMutation = useMutation({
    mutationFn: () => botApi.resume(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bot-status'] }),
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <p className="text-slate-400">Loading dashboard…</p>
        </div>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="text-red-400">Failed to load dashboard</p>
            <p className="mt-1 text-xs text-slate-500">Check that the API server is running</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const workerOnline = data.worker.status === 'online';
  const todayPnlTrend = data.todayPnl > 0 ? 'up' : data.todayPnl < 0 ? 'down' : 'neutral';
  const winRate = data.winRateToday > 0 ? `${(data.winRateToday * 100).toFixed(1)}%` : '—';

  return (
    <AppShell>
      <div className="p-6">
        {/* ── Top bar ── */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Dashboard</h1>
            <p className="text-sm text-slate-400">
              {data.isPaper ? '📋 Paper Trading' : '🔴 Live Trading'} ·{' '}
              {data.currency}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Worker controls */}
            {workerOnline ? (
              <Button
                variant="ghost"
                onClick={() => pauseMutation.mutate()}
                disabled={pauseMutation.isPending}
              >
                ⏸ Pause
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => resumeMutation.mutate()}
                disabled={resumeMutation.isPending}
              >
                ▶ Resume
              </Button>
            )}
            <EmergencyStopButton />
          </div>
        </div>

        {/* ── Worker status banner ── */}
        <div className={`mb-6 flex items-center justify-between rounded-xl border px-5 py-3 ${
          data.worker.status === 'online'
            ? 'border-green-500/30 bg-green-500/10'
            : data.worker.status === 'stale'
            ? 'border-amber-500/30 bg-amber-500/10'
            : 'border-red-500/30 bg-red-500/10'
        }`}>
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${
              workerOnline ? 'bg-green-400 animate-pulse' : 'bg-red-400'
            }`} />
            <div>
              <span className={`text-sm font-semibold ${workerOnline ? 'text-green-400' : 'text-red-400'}`}>
                {workerOnline ? '🟢 Worker Online' : data.worker.status === 'stale' ? '🟡 Worker Stale' : '🔴 Worker Offline'}
              </span>
              <span className="ml-3 text-xs text-slate-400">
                Last heartbeat: {timeAgo(data.worker.lastHeartbeat)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span>Uptime: {formatUptime(data.worker.uptimeSeconds)}</span>
            <span>Memory: {data.worker.memoryMb}MB</span>
            <Badge variant={data.worker.tradingMode === 'PAPER' ? 'amber' : 'red'}>
              {data.worker.tradingMode}
            </Badge>
          </div>
        </div>

        {/* ── Account stats ── */}
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Account Balance"
            value={formatCurrency(data.balance)}
            sub={`Equity: ${formatCurrency(data.equity)}`}
            trend="neutral"
          />
          <StatCard
            label="Today's P&L"
            value={formatCurrency(data.todayPnl)}
            sub={formatPercent(data.todayPnlPercent * 100)}
            trend={todayPnlTrend}
          />
          <StatCard
            label="Max Drawdown"
            value={formatPercent(data.drawdownPercent)}
            sub={`HWM: ${formatCurrency(data.highWaterMark)}`}
            trend={data.drawdownPercent > 5 ? 'down' : 'neutral'}
          />
          <StatCard
            label="All-Time P&L"
            value={formatCurrency(data.allTimePnl)}
            sub={`${data.allTimeTrades} total trades`}
            trend={data.allTimePnl > 0 ? 'up' : data.allTimePnl < 0 ? 'down' : 'neutral'}
          />
        </div>

        {/* ── Trade counters ── */}
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Trades Today" value={String(data.tradesToday)} sub="of 5 max" trend="neutral" />
          <StatCard label="Wins Today"   value={String(data.winningToday)} sub="closed" trend={data.winningToday > 0 ? 'up' : 'neutral'} />
          <StatCard label="Losses Today" value={String(data.losingToday)}  sub="closed" trend={data.losingToday > 0 ? 'down' : 'neutral'} />
          <StatCard label="Win Rate"     value={winRate} sub="today" trend={data.winRateToday > 0.5 ? 'up' : 'neutral'} />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* ── Open positions ── */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Open Positions</CardTitle>
                <Badge variant={data.openPositions.length > 0 ? 'blue' : 'slate'}>
                  {data.openPositions.length} open
                </Badge>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {data.openPositions.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-slate-500">
                  No open positions
                </p>
              ) : (
                <div className="divide-y divide-slate-700">
                  {data.openPositions.map((pos) => (
                    <div key={pos.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-100">{pos.symbol}</span>
                          <Badge variant={pos.side === 'LONG' ? 'green' : 'red'}>
                            {pos.side}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-500">
                          Entry: {pos.entryPrice.toFixed(2)} · SL: {pos.stopLoss.toFixed(2)} · TP: {pos.takeProfit.toFixed(2)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${pnlColor(pos.unrealisedPnl)}`}>
                          {formatCurrency(pos.unrealisedPnl)}
                        </p>
                        <p className="text-xs text-slate-500">{timeAgo(pos.openedAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* ── Recent system events ── */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Events</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              {data.recentEvents.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-slate-500">No events yet</p>
              ) : (
                <div className="divide-y divide-slate-700/50 max-h-64 overflow-y-auto">
                  {data.recentEvents.map((ev) => {
                    const levelColor: Record<string, string> = {
                      info:  'text-blue-400',
                      warn:  'text-amber-400',
                      error: 'text-red-400',
                      debug: 'text-slate-500',
                    };
                    return (
                      <div key={ev.id} className="flex items-start gap-3 px-5 py-2.5">
                        <span className={`mt-0.5 text-xs font-bold uppercase ${levelColor[ev.level] ?? 'text-slate-400'}`}>
                          {ev.level}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-slate-300">{ev.message}</p>
                          <p className="text-xs text-slate-500">{timeAgo(ev.createdAt)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ── Market data + Risk + AI ── */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <MarketDataHealth />
          <RiskStatusWidget />
          <AIStatusWidget />
        </div>
      </div>
    </AppShell>
  );
}
