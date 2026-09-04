'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardBody, Badge } from '@/components/ui/index';

type MarketPair = {
  symbol: string;
  timeframe: string;
  lastCandle: string | null;
  ageMinutes: number | null;
  fresh: boolean;
};

async function fetchMarketHealth(): Promise<{ allFresh: boolean; pairs: MarketPair[] }> {
  const res = await fetch(
    `${process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'}/market/health`,
    { credentials: 'include' },
  );
  const json = await res.json() as { success: boolean; data: { allFresh: boolean; pairs: MarketPair[] } };
  return json.data;
}

export function MarketDataHealth(): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['market-health'],
    queryFn:  fetchMarketHealth,
    refetchInterval: 60_000,
  });

  // Group by symbol
  const bySymbol = new Map<string, MarketPair[]>();
  for (const pair of data?.pairs ?? []) {
    if (!bySymbol.has(pair.symbol)) bySymbol.set(pair.symbol, []);
    bySymbol.get(pair.symbol)!.push(pair);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Market Data</CardTitle>
          {!isLoading && (
            <Badge variant={data?.allFresh ? 'green' : 'amber'}>
              {data?.allFresh ? '✓ All fresh' : '⚠ Stale data'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {isLoading ? (
          <p className="px-5 py-4 text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="divide-y divide-slate-700/50">
            {Array.from(bySymbol.entries()).map(([symbol, pairs]) => (
              <div key={symbol} className="px-5 py-3">
                <p className="mb-2 text-xs font-semibold text-slate-300">{symbol}</p>
                <div className="flex flex-wrap gap-2">
                  {pairs.map((p) => (
                    <div
                      key={p.timeframe}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${
                        p.fresh
                          ? 'border-green-500/20 bg-green-500/5 text-green-400'
                          : 'border-amber-500/20 bg-amber-500/5 text-amber-400'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${p.fresh ? 'bg-green-400' : 'bg-amber-400'}`} />
                      <span className="font-mono">{p.timeframe}</span>
                      {p.ageMinutes !== null && (
                        <span className="text-slate-500">{p.ageMinutes}m</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
