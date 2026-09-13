'use client';

import { useQuery } from '@tanstack/react-query';
import { signalsApi, type DecisionLog } from '@/lib/api';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardHeader, CardTitle, CardBody, Badge } from '@/components/ui/index';
import { timeAgo } from '@/lib/format';

function OutcomeBadge({ outcome }: { outcome: DecisionLog['outcome'] }): React.ReactElement {
  if (outcome === 'APPROVED') return <Badge variant="green">✓ APPROVED</Badge>;
  if (outcome === 'REJECTED') return <Badge variant="red">✗ REJECTED</Badge>;
  return <Badge variant="amber">⚠ NO TRADE (AI)</Badge>;
}

function DecisionCard({ log }: { log: DecisionLog }): React.ReactElement {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-base font-bold text-slate-100">{log.symbol}</span>
          <Badge variant="slate">{log.marketRegime.replace('_', ' ')}</Badge>
          <OutcomeBadge outcome={log.outcome} />
        </div>
        <span className="text-xs text-slate-500">{timeAgo(log.createdAt)}</span>
      </div>

      {/* Metrics grid */}
      <div className="mb-4 grid grid-cols-3 gap-3 lg:grid-cols-6">
        {[
          {
            label: 'Strategy',
            value: `${log.strategyScore}`,
            sub: `/ ${log.requiredStrategyScore} req`,
            ok: log.strategyScore >= log.requiredStrategyScore,
          },
          {
            label: 'AI Confidence',
            value: log.aiConfidence !== null ? `${(log.aiConfidence * 100).toFixed(0)}%` : '—',
            sub: log.aiDecision ?? 'N/A',
            ok: log.aiConfidence !== null && log.aiConfidence >= (log.requiredAiConfidence ?? 0),
          },
          {
            label: 'Risk/Reward',
            value: log.riskReward !== null ? `${log.riskReward.toFixed(1)}` : '—',
            sub: `/ ${log.requiredRiskReward.toFixed(1)} req`,
            ok: log.riskReward !== null && log.riskReward >= log.requiredRiskReward,
          },
          {
            label: 'Risk Engine',
            value: log.riskDecision ?? '—',
            sub: '',
            ok: log.riskDecision === 'APPROVED',
          },
        ].map(({ label, value, sub, ok }) => (
          <div
            key={label}
            className={`rounded-lg border p-3 ${
              ok
                ? 'border-green-500/20 bg-green-500/5'
                : 'border-red-500/20 bg-red-500/5'
            }`}
          >
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`text-sm font-bold ${ok ? 'text-green-400' : 'text-red-400'}`}>{value}</p>
            {sub && <p className="text-xs text-slate-500">{sub}</p>}
          </div>
        ))}
      </div>

      {/* Final reason */}
      <div className="rounded-lg bg-slate-900/60 px-4 py-3">
        <p className="text-xs font-medium text-slate-400">Final Decision</p>
        <p className="mt-0.5 text-sm text-slate-200">{log.finalReason}</p>
      </div>

      {/* Rejection reasons */}
      {log.riskRejectionReasons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {log.riskRejectionReasons.map((r) => (
            <span key={r} className="rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs text-red-400">
              {r}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SignalsPage(): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['decisions'],
    queryFn: () => signalsApi.getDecisions(50),
    refetchInterval: 30_000,
  });

  const approved = data?.filter((d) => d.outcome === 'APPROVED').length ?? 0;
  const rejected = data?.filter((d) => d.outcome === 'REJECTED').length ?? 0;

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Signals & Decisions</h1>
            <p className="text-sm text-slate-400">Full transparency on every trade evaluation</p>
          </div>
          <div className="flex gap-3">
            <Badge variant="green">✓ {approved} approved</Badge>
            <Badge variant="red">✗ {rejected} rejected</Badge>
          </div>
        </div>

        {isLoading ? (
          <p className="text-slate-400">Loading decision log…</p>
        ) : !data || data.length === 0 ? (
          <Card>
            <CardBody>
              <p className="py-8 text-center text-sm text-slate-500">
                No signal evaluations yet. Once the strategy engine runs (Phase 5), every
                decision — approved or rejected — will appear here with full reasoning.
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-4">
            {data.map((log) => (
              <DecisionCard key={log.id} log={log} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
