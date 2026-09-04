import type { Order, Prisma } from '@prisma/client';
import { prisma } from '../client';

// =============================================================================
// ORDER REPOSITORY
// =============================================================================

export type CreateOrderData = {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
  quantity: number;
  price?: number;
  stopPrice?: number;
  isPaper: boolean;
  positionId?: string;
};

export type UpdateOrderData = Partial<{
  status: string;
  exchangeOrderId: string;
  filledQuantity: number;
  avgFillPrice: number;
  fees: number;
  feeCurrency: string;
  filledAt: Date;
}>;

export async function createOrder(data: CreateOrderData): Promise<Order> {
  return prisma.order.create({
    data: {
      ...data,
      status: 'PENDING',
    },
  });
}

export async function getOrderById(id: string): Promise<Order | null> {
  return prisma.order.findUnique({ where: { id } });
}

export async function getOrderByClientId(clientOrderId: string): Promise<Order | null> {
  return prisma.order.findUnique({ where: { clientOrderId } });
}

export async function updateOrder(id: string, data: UpdateOrderData): Promise<Order> {
  return prisma.order.update({ where: { id }, data });
}

export async function getOrdersForPosition(positionId: string): Promise<Order[]> {
  return prisma.order.findMany({
    where: { positionId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getRecentOrders(
  isPaper: boolean,
  limit = 50,
): Promise<Order[]> {
  return prisma.order.findMany({
    where: { isPaper },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function cancelPendingOrders(isPaper: boolean): Promise<number> {
  const result = await prisma.order.updateMany({
    where: { isPaper, status: { in: ['PENDING', 'OPEN'] } },
    data: { status: 'CANCELLED' },
  });
  return result.count;
}
