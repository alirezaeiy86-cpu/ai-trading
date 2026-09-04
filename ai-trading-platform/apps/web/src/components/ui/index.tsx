import { clsx } from 'clsx';

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={clsx('rounded-xl border border-slate-700 bg-slate-800', className)}>
      {children}
    </div>
  );
}

export function CardHeader({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="border-b border-slate-700 px-5 py-4">
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }): React.ReactElement {
  return <h3 className="text-sm font-semibold text-slate-300">{children}</h3>;
}

export function CardBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return <div className={clsx('px-5 py-4', className)}>{children}</div>;
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
export function StatCard({
  label,
  value,
  sub,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: 'up' | 'down' | 'neutral';
}): React.ReactElement {
  const valueColor =
    trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-slate-100';

  return (
    <Card className="p-4">
      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className={clsx('text-xl font-bold', valueColor)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </Card>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
type BadgeVariant = 'green' | 'red' | 'amber' | 'blue' | 'slate';

const badgeStyles: Record<BadgeVariant, string> = {
  green: 'bg-green-500/15 text-green-400 border-green-500/30',
  red:   'bg-red-500/15 text-red-400 border-red-500/30',
  amber: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  blue:  'bg-blue-500/15 text-blue-400 border-blue-500/30',
  slate: 'bg-slate-700 text-slate-300 border-slate-600',
};

export function Badge({
  children,
  variant = 'slate',
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
}): React.ReactElement {
  return (
    <span className={clsx('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', badgeStyles[variant])}>
      {children}
    </span>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'danger' | 'ghost' | 'warning';

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-500',
  danger:  'bg-red-600 text-white hover:bg-red-500',
  warning: 'bg-amber-600 text-white hover:bg-amber-500',
  ghost:   'bg-slate-700 text-slate-300 hover:bg-slate-600',
};

export function Button({
  children,
  variant = 'primary',
  onClick,
  disabled,
  className,
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        buttonStyles[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
export function ProgressBar({
  value,
  max,
  color = 'blue',
}: {
  value: number;
  max: number;
  color?: 'blue' | 'green' | 'red' | 'amber';
}): React.ReactElement {
  const pct = Math.min((value / max) * 100, 100);
  const barColor = {
    blue:  'bg-blue-500',
    green: 'bg-green-500',
    red:   'bg-red-500',
    amber: 'bg-amber-500',
  }[color];

  return (
    <div className="h-1.5 w-full rounded-full bg-slate-700">
      <div
        className={clsx('h-1.5 rounded-full transition-all', barColor)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
