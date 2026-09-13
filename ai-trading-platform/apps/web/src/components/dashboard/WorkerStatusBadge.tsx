interface WorkerStatusBadgeProps {
  status: 'online' | 'offline' | 'stale' | 'paused' | 'emergency';
  lastHeartbeat: Date | null;
}

export function WorkerStatusBadge({ status, lastHeartbeat }: WorkerStatusBadgeProps): React.ReactElement {
  const config = {
    online: { dot: 'bg-green-400', text: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30', label: '🟢 Worker Online' },
    offline: { dot: 'bg-red-400', text: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', label: '🔴 Worker Offline' },
    stale: { dot: 'bg-amber-400', text: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', label: '🟡 Worker Stale' },
    paused: { dot: 'bg-blue-400', text: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30', label: '⏸ Worker Paused' },
    emergency: { dot: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/20 border-red-500/50', label: '🛑 Emergency Stop' },
  }[status];

  const heartbeatText = lastHeartbeat
    ? `Last heartbeat: ${Math.floor((Date.now() - lastHeartbeat.getTime()) / 1000)}s ago`
    : 'No heartbeat received';

  return (
    <div className={`flex items-center gap-2 rounded-full border px-3 py-1 ${config.bg}`}>
      <span className={`h-2 w-2 rounded-full ${config.dot} ${status === 'online' ? 'animate-pulse' : ''}`} />
      <div>
        <span className={`text-xs font-medium ${config.text}`}>{config.label}</span>
        <span className="ml-2 text-xs text-slate-500">{heartbeatText}</span>
      </div>
    </div>
  );
}
