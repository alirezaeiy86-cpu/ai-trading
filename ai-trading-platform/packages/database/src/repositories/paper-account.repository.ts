import type { PaperAccount } from '@prisma/client';
import { prisma } from '../client';

// =============================================================================
// PAPER ACCOUNT REPOSITORY
// Single-row pattern — one paper account.
// =============================================================================

const PAPER_ACCOUNT_ID = 'paper-main';

/**
 * Get or initialise the paper account.
 * @param initialBalance - Used only on first creation
 */
export async function getPaperAccount(initialBalance = 10000): Promise<PaperAccount> {
  const existing = await prisma.paperAccount.findUnique({
    where: { id: PAPER_ACCOUNT_ID },
  });
  if (existing) return existing;

  return prisma.paperAccount.create({
    data: {
      id: PAPER_ACCOUNT_ID,
      initialBalance,
      currentBalance: initialBalance,
      equity: initialBalance,
      highWaterMark: initialBalance,
      currency: 'USDT',
    },
  });
}

/**
 * Update the paper account balance and equity.
 */
export async function updatePaperAccount(data: {
  currentBalance?: number;
  equity?: number;
  highWaterMark?: number;
}): Promise<PaperAccount> {
  // Automatically update high water mark if equity increased
  const current = await getPaperAccount();
  const newEquity = data.equity ?? current.equity;
  const newHwm = Math.max(current.highWaterMark, newEquity);

  return prisma.paperAccount.update({
    where: { id: PAPER_ACCOUNT_ID },
    data: {
      ...data,
      highWaterMark: newHwm,
    },
  });
}

/**
 * Calculate current drawdown as a percentage.
 */
export async function getCurrentDrawdownPercent(): Promise<number> {
  const account = await getPaperAccount();
  if (account.highWaterMark === 0) return 0;
  return (account.highWaterMark - account.equity) / account.highWaterMark;
}

/**
 * Reset the paper account to initial state.
 * Should require explicit user confirmation before calling.
 */
export async function resetPaperAccount(newBalance: number): Promise<PaperAccount> {
  return prisma.paperAccount.update({
    where: { id: PAPER_ACCOUNT_ID },
    data: {
      currentBalance: newBalance,
      equity: newBalance,
      highWaterMark: newBalance,
    },
  });
}
