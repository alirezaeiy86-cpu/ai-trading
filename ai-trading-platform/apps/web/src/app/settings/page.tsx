'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi, type TradingSettings } from '@/lib/api';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardHeader, CardTitle, CardBody, Button } from '@/components/ui/index';
import { useState, useEffect } from 'react';

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between border-b border-slate-700/50 py-4 last:border-0">
      <div className="mr-8">
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        value ? 'bg-blue-600' : 'bg-slate-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          value ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function NumberInput({
  value,
  onChange,
  step = 0.01,
  min = 0,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}): React.ReactElement {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-28 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-right text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
    />
  );
}

export default function SettingsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Partial<TradingSettings>>({});
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const { mutate, isPending } = useMutation({
    mutationFn: (updates: Partial<TradingSettings>) => settingsApi.update(updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const set = <K extends keyof TradingSettings>(key: K, value: TradingSettings[K]): void => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  if (isLoading || !data) {
    return (
      <AppShell>
        <div className="p-6">
          <p className="text-slate-400">Loading settings…</p>
        </div>
      </AppShell>
    );
  }

  const s = { ...data, ...draft };

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Settings</h1>
            <p className="text-sm text-slate-400">Risk controls and trading configuration</p>
          </div>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-sm text-green-400">✓ Saved</span>
            )}
            <Button
              onClick={() => mutate(draft)}
              disabled={isPending || Object.keys(draft).length === 0}
            >
              {isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </div>

        {/* Position Sizing */}
        <Card>
          <CardHeader><CardTitle>Position Sizing & Risk</CardTitle></CardHeader>
          <CardBody>
            <SettingRow
              label="Risk Per Trade"
              description="Percentage of account balance risked on each trade"
            >
              <div className="flex items-center gap-2">
                <NumberInput
                  value={s.riskPerTradePercent * 100}
                  onChange={(v) => set('riskPerTradePercent', v / 100)}
                  step={0.1} min={0.1} max={5}
                />
                <span className="text-sm text-slate-400">%</span>
              </div>
            </SettingRow>
            <SettingRow
              label="Min Risk/Reward Ratio"
              description="Reject trades below this R:R ratio"
            >
              <NumberInput
                value={s.minRiskReward}
                onChange={(v) => set('minRiskReward', v)}
                step={0.1} min={1} max={10}
              />
            </SettingRow>
            <SettingRow label="Max Leverage" description="1 = spot only (recommended)">
              <NumberInput
                value={s.maxLeverage}
                onChange={(v) => set('maxLeverage', v)}
                step={1} min={1} max={20}
              />
            </SettingRow>
          </CardBody>
        </Card>

        {/* Loss Limits */}
        <Card>
          <CardHeader><CardTitle>Loss Limits</CardTitle></CardHeader>
          <CardBody>
            <SettingRow
              label="Max Daily Loss"
              description="Stop trading for the day when this % loss is reached"
            >
              <div className="flex items-center gap-2">
                <NumberInput
                  value={s.maxDailyLossPercent * 100}
                  onChange={(v) => set('maxDailyLossPercent', v / 100)}
                  step={0.1} min={0.5} max={20}
                />
                <span className="text-sm text-slate-400">%</span>
              </div>
            </SettingRow>
            <SettingRow
              label="Max Weekly Loss"
              description="Stop trading for the week when this % loss is reached"
            >
              <div className="flex items-center gap-2">
                <NumberInput
                  value={s.maxWeeklyLossPercent * 100}
                  onChange={(v) => set('maxWeeklyLossPercent', v / 100)}
                  step={0.1} min={1} max={30}
                />
                <span className="text-sm text-slate-400">%</span>
              </div>
            </SettingRow>
            <SettingRow
              label="Max Drawdown"
              description="Disable trading when peak-to-trough drawdown exceeds this"
            >
              <div className="flex items-center gap-2">
                <NumberInput
                  value={s.maxDrawdownPercent * 100}
                  onChange={(v) => set('maxDrawdownPercent', v / 100)}
                  step={0.5} min={1} max={50}
                />
                <span className="text-sm text-slate-400">%</span>
              </div>
            </SettingRow>
          </CardBody>
        </Card>

        {/* Trade Limits */}
        <Card>
          <CardHeader><CardTitle>Trade Limits</CardTitle></CardHeader>
          <CardBody>
            <SettingRow label="Max Trades Per Day">
              <NumberInput
                value={s.maxTradesPerDay}
                onChange={(v) => set('maxTradesPerDay', v)}
                step={1} min={1} max={50}
              />
            </SettingRow>
            <SettingRow label="Max Open Positions">
              <NumberInput
                value={s.maxOpenPositions}
                onChange={(v) => set('maxOpenPositions', v)}
                step={1} min={1} max={20}
              />
            </SettingRow>
          </CardBody>
        </Card>

        {/* Signal Quality */}
        <Card>
          <CardHeader><CardTitle>Signal Quality Filters</CardTitle></CardHeader>
          <CardBody>
            <SettingRow
              label="Min Strategy Score"
              description="0–100. Reject signals below this score."
            >
              <NumberInput
                value={s.minStrategyScore}
                onChange={(v) => set('minStrategyScore', v)}
                step={1} min={0} max={100}
              />
            </SettingRow>
            <SettingRow
              label="Min AI Confidence"
              description="0–100%. Reject AI recommendations below this confidence."
            >
              <div className="flex items-center gap-2">
                <NumberInput
                  value={s.minAiConfidence * 100}
                  onChange={(v) => set('minAiConfidence', v / 100)}
                  step={1} min={0} max={100}
                />
                <span className="text-sm text-slate-400">%</span>
              </div>
            </SettingRow>
          </CardBody>
        </Card>

        {/* Direction */}
        <Card>
          <CardHeader><CardTitle>Direction & AI</CardTitle></CardHeader>
          <CardBody>
            <SettingRow label="Long Trades" description="Allow opening LONG positions">
              <Toggle value={s.longEnabled} onChange={(v) => set('longEnabled', v)} />
            </SettingRow>
            <SettingRow label="Short Trades" description="Allow opening SHORT positions">
              <Toggle value={s.shortEnabled} onChange={(v) => set('shortEnabled', v)} />
            </SettingRow>
            <SettingRow label="AI Enabled" description="Use AI for signal confirmation">
              <Toggle value={s.aiEnabled} onChange={(v) => set('aiEnabled', v)} />
            </SettingRow>
            <SettingRow
              label="AI Unavailable Mode"
              description="What to do when AI is rate-limited or down"
            >
              <select
                value={s.aiUnavailableMode}
                onChange={(e) => set('aiUnavailableMode', e.target.value)}
                className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="NO_TRADE">NO_TRADE (safer)</option>
                <option value="RULE_BASED">RULE_BASED</option>
              </select>
            </SettingRow>
          </CardBody>
        </Card>

        {/* Live trading lock notice */}
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
          <p className="text-sm font-semibold text-red-400">🔒 Live Trading</p>
          <p className="mt-1 text-xs text-slate-400">
            Live trading cannot be enabled from the dashboard. It requires setting{' '}
            <code className="rounded bg-slate-800 px-1 py-0.5 text-xs text-slate-200">
              LIVE_TRADING=true
            </code>{' '}
            and{' '}
            <code className="rounded bg-slate-800 px-1 py-0.5 text-xs text-slate-200">
              PAPER_TRADING=false
            </code>{' '}
            in the server environment, ensuring real exchange credentials are configured, and
            completing an extended paper trading validation period first.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
