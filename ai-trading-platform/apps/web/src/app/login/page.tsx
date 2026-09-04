'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

export default function LoginPage(): React.ReactElement {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, checkAuth, authenticated } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (authenticated) router.replace('/');
  }, [authenticated, router]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(password);
      router.replace('/');
    } catch {
      setError('Invalid password');
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        {/* Logo / title */}
        <div className="mb-8 text-center">
          <div className="mb-3 text-4xl">📈</div>
          <h1 className="text-2xl font-bold text-slate-100">AI Trading Platform</h1>
          <p className="mt-1 text-sm text-slate-400">Personal trading dashboard</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-8">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-300">
                Dashboard Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 text-slate-100 placeholder-slate-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          🔒 Private system · Paper trading mode
        </p>
      </div>
    </div>
  );
}
