interface StatusCardProps {
  label: string;
  value: string;
  subValue?: string;
  trend: 'up' | 'down' | 'neutral';
}

export function StatusCard({ label, value, subValue, trend }: StatusCardProps): React.ReactElement {
  const trendColor =
    trend === 'up'
      ? 'text-green-400'
      : trend === 'down'
        ? 'text-red-400'
        : 'text-slate-300';

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`text-xl font-bold ${trendColor}`}>{value}</p>
      {subValue && <p className="mt-1 text-xs text-slate-500">{subValue}</p>}
    </div>
  );
}
