'use client';

import { useQuery } from '@tanstack/react-query';
import { riskApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardBody, ProgressBar, Badge } from '@/components/ui/index';
import { formatCurrency, formatPercent } from '@/lib/format';

export function RiskStatusWidget(): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['risk-status'],
    queryFn:  riskApi.getStatus,
    refetchInterval: 30_000,
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader><CardTitle>Risk Status</CardTitle></CardHeader>
        <CardBody><p className="text-sm text-slate-400">Loading…</p></CardBody>
      </Card>
    );
  }

  const items = [
    {
      label:    'Daily Loss',
      current:  data.dailyLossPct,
      max:      data.maxDailyLossPct,
      breached: data.dailyLossBreached,
      color:    data.dailyLossBreached ? 'red' : 'blue',
    },
    {
      label:    'Drawdown',
      current:  data.currentDrawdownPct,
      max:      data.maxDrawdownPct,
      breached: data.drawdownBreached,
      color:    data.drawdownBreached ? 'red' : 'amber',
    },
    {
      label:    'Weekly Loss',
      current:  data.weeklyLossPct,
      max:      data.maxWeeklyLossPct,
      breached: data.weeklyLossBreached,
      color:    data.weeklyLossBreached ? 'red' : 'blue',
    },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Risk Status</CardTitle>
          <Badge variant={data.canTrade ? 'green' : 'red'}>
            {data.canTrade ? '✓ Can Trade' : '✗ Blocked'}
          </Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* Limits progress bars */}
        {items.map(({ label, current, max, breached, color }) => (
          <div key={label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className={breached ? 'text-red-400 font-semibold' : 'text-slate-400'}>
                {label}
              </span>
              <span className={breached ? 'text-red-400' : 'text-slate-300'}>
                {current.toFixed(2)}% / {max.toFixed(2)}%
              </span>
            </div>
            <ProgressBar
              value={current}
              max={max}
              color={color as 'blue' | 'red' | 'amber' | 'green'}
            />
          </div>
        ))}

        {/* Trade / position counters */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className={`rounded-lg border p-3 ${
            data.tradesLimitReached
              ? 'border-red-500/30 bg-red-500/5'
              : 'border-slate-700 bg-slate-800/50'
          }`}>
            <p className="text-xs text-slate-500">Trades Today</p>
            <p className={`text-lg font-bold ${data.tradesLimitReached ? 'text-red-400' : 'text-slate-100'}`}>
              {data.tradesToday} / {data.maxTradesPerDay}
            </p>
          </div>
          <div className={`rounded-lg border p-3 ${
            data.positionsLimitReached
              ? 'border-red-500/30 bg-red-500/5'
              : 'border-slate-700 bg-slate-800/50'
          }`}>
            <p className="text-xs text-slate-500">Open Positions</p>
            <p className={`text-lg font-bold ${data.positionsLimitReached ? 'text-red-400' : 'text-slate-100'}`}>
              {data.openPositionsCount} / {data.maxOpenPositions}
            </p>
          </div>
        </div>

        {/* P&L summary */}
        <div className="border-t border-slate-700 pt-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              { label: "Today's P&L", value: formatCurrency(data.todayTotalPnl) },
              { label: "Week P&L",    value: formatCurrency(data.weekPnl) },
              { label: "Balance",     value: formatCurrency(data.balance) },
              { label: "Equity",      value: formatCurrency(data.equity) },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-slate-500">{label}</p>
                <p className="text-slate-200 font-medium">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
