import type { Position, Prisma } from '@prisma/client';
import { prisma } from '../client';

// =============================================================================
// POSITION REPOSITORY
// =============================================================================

export type CreatePositionData = {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  isPaper: boolean;
  strategyScore?: number;
  aiConfidence?: number;
  marketRegimeAtEntry?: string;
};

export type UpdatePositionData = Partial<{
  status: 'OPEN' | 'CLOSED';
  currentPrice: number;
  unrealisedPnl: number;
  realisedPnl: number;
  fees: number;
  closedAt: Date;
  closeReason: string;
  stopLoss: number;
  takeProfit: number;
}>;

/**
 * Create a new position record.
 */
export async function createPosition(data: CreatePositionData): Promise<Position> {
  return prisma.position.create({
    data: {
      ...data,
      status: 'OPEN',
      openedAt: new Date(),
      currentPrice: data.entryPrice,
    },
  });
}

/**
 * Get a position by ID.
 */
export async function getPositionById(id: string): Promise<Position | null> {
  return prisma.position.findUnique({ where: { id } });
}

/**
 * Get all currently open positions.
 */
export async function getOpenPositions(isPaper: boolean): Promise<Position[]> {
  return prisma.position.findMany({
    where: { status: 'OPEN', isPaper },
    orderBy: { openedAt: 'desc' },
  });
}

/**
 * Get open position for a specific symbol (if any).
 */
export async function getOpenPositionForSymbol(
  symbol: string,
  isPaper: boolean,
): Promise<Position | null> {
  return prisma.position.findFirst({
    where: { symbol, status: 'OPEN', isPaper },
  });
}

/**
 * Update a position (price, PnL, status, etc).
 */
export async function updatePosition(id: string, data: UpdatePositionData): Promise<Position> {
  return prisma.position.update({ where: { id }, data });
}

/**
 * Close a position with final PnL and reason.
 */
export async function closePosition(
  id: string,
  realisedPnl: number,
  fees: number,
  closeReason: string,
): Promise<Position> {
  return prisma.position.update({
    where: { id },
    data: {
      status: 'CLOSED',
      realisedPnl,
      fees,
      closeReason,
      closedAt: new Date(),
      unrealisedPnl: 0,
    },
  });
}

/**
 * Get closed positions (recent history).
 */
export async function getClosedPositions(
  isPaper: boolean,
  limit = 50,
  offset = 0,
): Promise<{ positions: Position[]; total: number }> {
  const [positions, total] = await Promise.all([
    prisma.position.findMany({
      where: { status: 'CLOSED', isPaper },
      orderBy: { closedAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.position.count({ where: { status: 'CLOSED', isPaper } }),
  ]);
  return { positions, total };
}

/**
 * Count trades opened today (UTC).
 */
export async function countTradesToday(isPaper: boolean): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  return prisma.position.count({
    where: {
      isPaper,
      openedAt: { gte: startOfDay },
    },
  });
}

/**
 * Get today's realised PnL (UTC).
 */
export async function getTodayRealisedPnl(isPaper: boolean): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const result = await prisma.position.aggregate({
    _sum: { realisedPnl: true },
    where: {
      isPaper,
      status: 'CLOSED',
      closedAt: { gte: startOfDay },
    },
  });
  return result._sum.realisedPnl ?? 0;
}

/**
 * Get this week's realised PnL (UTC, starts Monday).
 */
export async function getWeekRealisedPnl(isPaper: boolean): Promise<number> {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon ...
  const diffToMonday = (dayOfWeek + 6) % 7;
  const startOfWeek = new Date(now);
  startOfWeek.setUTCDate(now.getUTCDate() - diffToMonday);
  startOfWeek.setUTCHours(0, 0, 0, 0);

  const result = await prisma.position.aggregate({
    _sum: { realisedPnl: true },
    where: {
      isPaper,
      status: 'CLOSED',
      closedAt: { gte: startOfWeek },
    },
  });
  return result._sum.realisedPnl ?? 0;
}

/**
 * Get last N closed positions (for consecutive loss checking).
 */
export async function getLastClosedPositions(
  isPaper: boolean,
  count: number,
): Promise<Position[]> {
  return prisma.position.findMany({
    where: { status: 'CLOSED', isPaper },
    orderBy: { closedAt: 'desc' },
    take: count,
  });
}
