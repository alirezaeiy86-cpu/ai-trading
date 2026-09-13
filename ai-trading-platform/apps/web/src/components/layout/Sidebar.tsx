'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useQuery } from '@tanstack/react-query';
import { botApi } from '@/lib/api';

const navItems = [
  { href: '/',           icon: '📊', label: 'Dashboard' },
  { href: '/positions',  icon: '📂', label: 'Positions' },
  { href: '/signals',    icon: '🔍', label: 'Signals' },
  { href: '/backtest',   icon: '🔬', label: 'Backtest' },
  { href: '/monitoring', icon: '🖥️', label: 'Monitoring' },
  { href: '/settings',   icon: '⚙️',  label: 'Settings' },
  { href: '/logs',       icon: '📋', label: 'Logs' },
];

export function Sidebar(): React.ReactElement {
  const pathname = usePathname();
  const { logout } = useAuthStore();

  const { data: botStatus } = useQuery({
    queryKey: ['bot-status'],
    queryFn: botApi.getStatus,
    refetchInterval: 15_000,
  });

  const workerAlive = botStatus?.workerAlive ?? false;
  const tradingMode = botStatus?.tradingMode ?? 'PAPER';

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-slate-700 bg-slate-800">
      {/* Header */}
      <div className="border-b border-slate-700 px-4 py-5">
        <div className="flex items-center gap-2">
          <span className="text-xl">📈</span>
          <div>
            <p className="text-sm font-bold text-slate-100">AI Trader</p>
            <p className="text-xs text-slate-500">v0.1.0</p>
          </div>
        </div>
      </div>

      {/* Worker status pill */}
      <div className="border-b border-slate-700 px-4 py-3">
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
          workerAlive ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
        }`}>
          <span className={`h-2 w-2 rounded-full ${workerAlive ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
          <div className="min-w-0">
            <p className="font-medium">{workerAlive ? '🟢 Worker Online' : '🔴 Worker Offline'}</p>
            <p className="text-slate-500">{tradingMode} mode</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map(({ href, icon, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-slate-700 hover:text-slate-100'
              }`}
            >
              <span>{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Paper trading badge */}
      <div className="px-4 py-3">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center">
          <p className="text-xs font-medium text-amber-400">📋 PAPER TRADING</p>
          <p className="text-xs text-slate-500">No real funds at risk</p>
        </div>
      </div>

      {/* Logout */}
      <div className="border-t border-slate-700 px-3 py-3">
        <button
          onClick={() => void logout()}
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-400 transition hover:bg-slate-700 hover:text-slate-100"
        >
          🚪 Sign Out
        </button>
      </div>
    </aside>
  );
}
