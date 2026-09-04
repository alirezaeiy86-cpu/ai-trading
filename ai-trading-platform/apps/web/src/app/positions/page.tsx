'use client';

import { useQuery } from '@tanstack/react-query';
import { positionsApi } from '@/lib/api';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardHeader, CardTitle, CardBody, Badge } from '@/components/ui/index';
import { formatCurrency, pnlColor, timeAgo } from '@/lib/format';

export default function PositionsPage(): React.ReactElement {
  const { data: open, isLoading: openLoading } = useQuery({
    queryKey: ['positions-open'],
    queryFn: positionsApi.getOpen,
    refetchInterval: 15_000,
  });

  const { data: history, isLoading: histLoading } = useQuery({
    queryKey: ['positions-history'],
    queryFn: () => positionsApi.getHistory(50, 0),
  });

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Positions</h1>
          <p className="text-sm text-slate-400">Open and closed positions</p>
        </div>

        {/* Open positions */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Open Positions</CardTitle>
              <Badge variant="blue">{open?.length ?? 0} open</Badge>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {openLoading ? (
              <p className="px-5 py-6 text-sm text-slate-400">Loading…</p>
            ) : !open || open.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No open positions</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      <th className="px-5 py-3">Symbol</th>
                      <th className="px-5 py-3">Side</th>
                      <th className="px-5 py-3">Entry</th>
                      <th className="px-5 py-3">Current</th>
                      <th className="px-5 py-3">SL</th>
                      <th className="px-5 py-3">TP</th>
                      <th className="px-5 py-3">Qty</th>
                      <th className="px-5 py-3">Unreal. PnL</th>
                      <th className="px-5 py-3">Opened</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {open.map((pos) => (
                      <tr key={pos.id} className="hover:bg-slate-700/30">
                        <td className="px-5 py-3 font-semibold text-slate-100">{pos.symbol}</td>
                        <td className="px-5 py-3">
                          <Badge variant={pos.side === 'LONG' ? 'green' : 'red'}>{pos.side}</Badge>
                        </td>
                        <td className="px-5 py-3 text-slate-300">{pos.entryPrice.toFixed(2)}</td>
                        <td className="px-5 py-3 text-slate-300">{pos.currentPrice.toFixed(2)}</td>
                        <td className="px-5 py-3 text-red-400">{pos.stopLoss.toFixed(2)}</td>
                        <td className="px-5 py-3 text-green-400">{pos.takeProfit.toFixed(2)}</td>
                        <td className="px-5 py-3 text-slate-300">{pos.quantity}</td>
                        <td className={`px-5 py-3 font-semibold ${pnlColor(pos.unrealisedPnl)}`}>
                          {formatCurrency(pos.unrealisedPnl)}
                        </td>
                        <td className="px-5 py-3 text-slate-500">{timeAgo(pos.openedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Trade history */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Trade History</CardTitle>
              <Badge variant="slate">{history?.total ?? 0} total</Badge>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {histLoading ? (
              <p className="px-5 py-6 text-sm text-slate-400">Loading…</p>
            ) : !history || history.items.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                No closed trades yet — start paper trading to see history here.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      <th className="px-5 py-3">Symbol</th>
                      <th className="px-5 py-3">Side</th>
                      <th className="px-5 py-3">Entry</th>
                      <th className="px-5 py-3">Closed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {history.items.map((pos) => (
                      <tr key={pos.id} className="hover:bg-slate-700/30">
                        <td className="px-5 py-3 font-semibold text-slate-100">{pos.symbol}</td>
                        <td className="px-5 py-3">
                          <Badge variant={pos.side === 'LONG' ? 'green' : 'red'}>{pos.side}</Badge>
                        </td>
                        <td className="px-5 py-3 text-slate-300">{pos.entryPrice.toFixed(2)}</td>
                        <td className="px-5 py-3 text-slate-500">{timeAgo(pos.openedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
