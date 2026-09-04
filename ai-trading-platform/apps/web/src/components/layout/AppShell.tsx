'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { Sidebar } from './Sidebar';

export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const { authenticated, loading, checkAuth } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!loading && !authenticated) {
      router.replace('/login');
    }
  }, [loading, authenticated, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-center">
          <div className="mb-3 text-3xl animate-pulse">📈</div>
          <p className="text-sm text-slate-400">Loading…</p>
        </div>
      </div>
    );
  }

  if (!authenticated) return <></>;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-900">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
