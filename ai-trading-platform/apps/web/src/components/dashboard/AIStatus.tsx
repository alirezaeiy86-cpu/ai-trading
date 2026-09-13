'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardBody, Badge, ProgressBar } from '@/components/ui/index';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

interface AIStatus {
  enabled:           boolean;
  provider:          string;
  model:             string;
  unavailableMode:   string;
  requestsToday:     number;
  maxPerDay:         number;
  remainingToday:    number;
  errorsToday:       number;
  rateLimitHitsToday: number;
}

interface AIPrediction {
  id:          string;
  symbol:      string;
  timeframe:   string;
  decision:    string;
  confidence:  number;
  marketRegime: string;
  latencyMs:   number;
  createdAt:   string;
}

async function authFetch<T>(path: string): Promise<T> {
  const res  = await fetch(`${API}${path}`, { credentials: 'include' });
  const json = await res.json() as { success: boolean; data: T };
  return json.data;
}

const decisionColor: Record<string, string> = {
  BUY:      'text-green-400',
  SELL:     'text-red-400',
  HOLD:     'text-amber-400',
  NO_TRADE: 'text-slate-400',
};

export function AIStatusWidget(): React.ReactElement {
  const { data: status } = useQuery({
    queryKey: ['ai-status'],
    queryFn:  () => authFetch<AIStatus>('/ai/status'),
    refetchInterval: 60_000,
  });

  const { data: analyses } = useQuery({
    queryKey: ['ai-analyses'],
    queryFn:  () => authFetch<AIPrediction[]>('/ai/analyses?limit=5'),
    refetchInterval: 30_000,
  });

  if (!status) {
    return (
      <Card>
        <CardHeader><CardTitle>AI Engine</CardTitle></CardHeader>
        <CardBody><p className="text-sm text-slate-400">Loading…</p></CardBody>
      </Card>
    );
  }

  const usagePct = status.maxPerDay > 0
    ? (status.requestsToday / status.maxPerDay) * 100
    : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>AI Engine</CardTitle>
          <Badge variant={status.enabled ? 'blue' : 'slate'}>
            {status.enabled ? '🤖 Active' : '⭕ Disabled'}
          </Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">

        {/* Provider info */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-slate-500">Provider</p>
            <p className="font-medium text-slate-200 capitalize">{status.provider}</p>
          </div>
          <div>
            <p className="text-slate-500">Model</p>
            <p className="font-medium text-slate-200 truncate">{status.model}</p>
          </div>
          <div>
            <p className="text-slate-500">Unavailable Mode</p>
            <p className={`font-medium ${status.unavailableMode === 'NO_TRADE' ? 'text-amber-400' : 'text-blue-400'}`}>
              {status.unavailableMode}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Errors Today</p>
            <p className={`font-medium ${status.errorsToday > 0 ? 'text-red-400' : 'text-slate-300'}`}>
              {status.errorsToday}
            </p>
          </div>
        </div>

        {/* Daily quota */}
        <div>
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="text-slate-400">Daily Quota</span>
            <span className={usagePct > 80 ? 'text-amber-400' : 'text-slate-300'}>
              {status.requestsToday} / {status.maxPerDay}
              {status.remainingToday > 0
                ? ` (${status.remainingToday} remaining)`
                : ' — exhausted'}
            </span>
          </div>
          <ProgressBar
            value={status.requestsToday}
            max={status.maxPerDay}
            color={usagePct > 90 ? 'red' : usagePct > 70 ? 'amber' : 'blue'}
          />
        </div>

        {/* Rate limit hits warning */}
        {status.rateLimitHitsToday > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
            ⚠️ {status.rateLimitHitsToday} rate limit hit{status.rateLimitHitsToday > 1 ? 's' : ''} today
          </div>
        )}

        {/* Recent predictions */}
        {analyses && analyses.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
              Recent Analyses
            </p>
            <div className="space-y-1.5">
              {analyses.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg bg-slate-900/60 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold ${decisionColor[a.decision] ?? 'text-slate-400'}`}>
                      {a.decision}
                    </span>
                    <span className="text-slate-400">{a.symbol}</span>
                    <span className="text-slate-600">{a.timeframe}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-500">
                    <span>{(a.confidence * 100).toFixed(0)}%</span>
                    <span>{a.latencyMs}ms</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {analyses?.length === 0 && (
          <p className="text-xs text-slate-500">No AI analyses yet — waiting for strategy signals.</p>
        )}
      </CardBody>
    </Card>
  );
}
