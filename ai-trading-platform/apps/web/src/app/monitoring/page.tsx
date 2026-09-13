'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardHeader, CardTitle, CardBody, Badge } from '@/components/ui/index';
import { timeAgo } from '@/lib/format';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

async function authFetch<T>(path: string): Promise<T> {
  const res  = await fetch(`${API}${path}`, { credentials: 'include' });
  const json = await res.json() as { success: boolean; data: T };
  return json.data;
}

// ── Health check ──────────────────────────────────────────────────────────────

interface HealthData {
  status:    'ok' | 'degraded' | 'down';
  version:   string;
  uptime:    number;
  timestamp: string;
  services: {
    database:   'ok' | 'error';
    redis:      'ok' | 'error';
    marketData: 'ok' | 'error';
    worker:     'ok' | 'stale' | 'offline';
  };
}

async function fetchHealth(): Promise<HealthData> {
  const res  = await fetch(`${API}/health`, { credentials: 'include' });
  return res.json() as Promise<HealthData>;
}

function ServiceDot({ status }: { status: 'ok' | 'error' | 'stale' | 'offline' }): React.ReactElement {
  const colors = { ok: 'bg-green-400', error: 'bg-red-400', stale: 'bg-amber-400', offline: 'bg-red-400' };
  const labels = { ok: 'OK', error: 'ERROR', stale: 'STALE', offline: 'OFFLINE' };
  const textColors = { ok: 'text-green-400', error: 'text-red-400', stale: 'text-amber-400', offline: 'text-red-400' };
  return (
    <span className={`flex items-center gap-1.5 text-xs ${textColors[status]}`}>
      <span className={`h-2 w-2 rounded-full ${colors[status]} ${status === 'ok' ? 'animate-pulse' : ''}`} />
      {labels[status]}
    </span>
  );
}

function HealthPanel(): React.ReactElement {
  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey:       ['health'],
    queryFn:        fetchHealth,
    refetchInterval: 15_000,
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>System Health</CardTitle>
          {data && (
            <Badge variant={data.status === 'ok' ? 'green' : 'red'}>
              {data.status.toUpperCase()}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <p className="text-sm text-slate-400">Checking…</p>
        ) : !data ? (
          <p className="text-sm text-red-400">API unreachable</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {(Object.entries(data.services) as [string, string][]).map(([name, status]) => (
                <div key={name} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2">
                  <span className="text-xs capitalize text-slate-300">{name}</span>
                  <ServiceDot status={status as 'ok' | 'error' | 'stale' | 'offline'} />
                </div>
              ))}
            </div>
            <div className="border-t border-slate-700 pt-3 text-xs text-slate-500">
              <p>Version: {data.version}</p>
              <p>API Uptime: {Math.floor(data.uptime / 60)}m {data.uptime % 60}s</p>
              <p>Checked: {timeAgo(new Date(dataUpdatedAt).toISOString())}</p>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ── Bot status ─────────────────────────────────────────────────────────────────

interface BotStatusData {
  workerAlive:  boolean;
  workerStatus: string;
  tradingMode:  string;
  lastHeartbeat: string | null;
  uptimeSeconds: number;
  memoryMb:      number;
  queuedJobs:    number;
}

function BotStatusPanel(): React.ReactElement {
  const { data } = useQuery({
    queryKey:       ['bot-status-monitor'],
    queryFn:        () => authFetch<BotStatusData>('/bot/status'),
    refetchInterval: 10_000,
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Worker Status</CardTitle>
          {data && (
            <Badge variant={data.workerAlive ? 'green' : 'red'}>
              {data.workerAlive ? '🟢 Online' : '🔴 Offline'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {!data ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="space-y-2 text-xs">
            {[
              { label: 'Status',       value: data.workerStatus },
              { label: 'Trading Mode', value: data.tradingMode },
              { label: 'Last Heartbeat', value: timeAgo(data.lastHeartbeat) },
              { label: 'Uptime',       value: data.uptimeSeconds > 0 ? `${Math.floor(data.uptimeSeconds / 60)}m ${data.uptimeSeconds % 60}s` : '—' },
              { label: 'Memory',       value: data.memoryMb > 0 ? `${data.memoryMb}MB` : '—' },
              { label: 'Queued Jobs',  value: String(data.queuedJobs) },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between border-b border-slate-700/40 pb-1.5">
                <span className="text-slate-500">{label}</span>
                <span className="font-medium text-slate-200">{value}</span>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ── Event timeline ────────────────────────────────────────────────────────────

interface SystemEvent {
  id:        string;
  type:      string;
  level:     'debug' | 'info' | 'warn' | 'error';
  message:   string;
  createdAt: string;
}

const LEVEL_COLORS: Record<string, string> = {
  info:  'text-blue-400  bg-blue-400/10  border-blue-400/20',
  warn:  'text-amber-400 bg-amber-400/10 border-amber-400/20',
  error: 'text-red-400   bg-red-400/10   border-red-400/20',
  debug: 'text-slate-500 bg-slate-800    border-slate-700',
};

const IMPORTANT_TYPES = new Set([
  'POSITION_OPENED', 'POSITION_CLOSED', 'STOP_LOSS_HIT', 'TAKE_PROFIT_HIT',
  'EMERGENCY_STOP', 'RISK_REJECTION', 'WORKER_STARTED', 'WORKER_STOPPED',
  'AI_RATE_LIMIT', 'MARKET_DATA_ERROR', 'DAILY_STATS',
]);

function EventTimeline(): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey:       ['events-monitor'],
    queryFn:        () => authFetch<SystemEvent[]>('/logs?limit=50'),
    refetchInterval: 15_000,
  });

  const important = data?.filter((e) => IMPORTANT_TYPES.has(e.type)) ?? [];
  const recent    = data?.slice(0, 20) ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Event Timeline</CardTitle>
          <span className="text-xs text-slate-500">{data?.length ?? 0} events</span>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {isLoading ? (
          <p className="px-5 py-4 text-sm text-slate-400">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">No events yet</p>
        ) : (
          <div className="max-h-96 divide-y divide-slate-700/30 overflow-y-auto">
            {recent.map((event) => {
              const levelStyle = LEVEL_COLORS[event.level] ?? LEVEL_COLORS['debug']!;
              const isKey      = IMPORTANT_TYPES.has(event.type);
              return (
                <div key={event.id} className={`flex items-start gap-3 px-4 py-2.5 ${isKey ? 'bg-slate-800/30' : ''}`}>
                  <div className="mt-0.5 w-14 flex-shrink-0 text-right text-xs text-slate-600">
                    {timeAgo(event.createdAt)}
                  </div>
                  <span className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium ${levelStyle}`}>
                    {event.level.toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-slate-200">{event.message}</p>
                    <p className="text-xs text-slate-600">{event.type}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ── AI usage chart ────────────────────────────────────────────────────────────

interface AIUsageDay {
  date:          string;
  requestsCount: number;
  errorsCount:   number;
  rateLimitHits: number;
}

function AIUsagePanel(): React.ReactElement {
  const { data } = useQuery({
    queryKey: ['ai-usage-monitor'],
    queryFn:  () => authFetch<{ daily: AIUsageDay[]; totals: { requests: number; errors: number; rateLimits: number } }>('/ai/usage?days=7'),
    refetchInterval: 60_000,
  });

  if (!data) return (
    <Card>
      <CardHeader><CardTitle>AI Usage (7 days)</CardTitle></CardHeader>
      <CardBody><p className="text-sm text-slate-400">Loading…</p></CardBody>
    </Card>
  );

  const maxRequests = Math.max(...data.daily.map((d) => d.requestsCount), 1);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>AI Usage (7 days)</CardTitle>
          <span className="text-xs text-slate-500">
            {data.totals.requests} total · {data.totals.errors} errors
          </span>
        </div>
      </CardHeader>
      <CardBody>
        {data.daily.length === 0 ? (
          <p className="text-sm text-slate-500">No AI requests yet</p>
        ) : (
          <div className="space-y-2">
            {[...data.daily].reverse().map((day) => (
              <div key={day.date} className="flex items-center gap-3">
                <span className="w-20 flex-shrink-0 text-right text-xs text-slate-500">
                  {day.date.slice(5)}
                </span>
                <div className="flex-1">
                  <div className="h-4 overflow-hidden rounded-sm bg-slate-700">
                    <div
                      className="h-full rounded-sm bg-blue-500 transition-all"
                      style={{ width: `${(day.requestsCount / maxRequests) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="w-8 text-right text-xs text-slate-300">{day.requestsCount}</span>
                {day.rateLimitHits > 0 && (
                  <span className="text-xs text-amber-400">⚠️{day.rateLimitHits}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MonitoringPage(): React.ReactElement {
  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Monitoring</h1>
          <p className="text-sm text-slate-400">System health, worker status, and event timeline</p>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <HealthPanel />
          <BotStatusPanel />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <EventTimeline />
          </div>
          <div>
            <AIUsagePanel />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
