'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { botApi } from '@/lib/api';

export function EmergencyStopButton(): React.ReactElement {
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: () => botApi.emergencyStop('Manual dashboard trigger'),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['bot-status'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-red-400">Are you sure?</span>
        <button
          onClick={() => mutate()}
          disabled={isPending}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50"
        >
          {isPending ? 'Stopping…' : 'CONFIRM'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="flex items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-400 transition hover:bg-red-500/20"
    >
      🛑 Emergency Stop
    </button>
  );
}
