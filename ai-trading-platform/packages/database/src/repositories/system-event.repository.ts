import type { SystemEvent } from '@prisma/client';
import { prisma } from '../client';
import type { SystemEventType, LogLevel } from '@trading/types';

// =============================================================================
// SYSTEM EVENT REPOSITORY
// =============================================================================

export type CreateEventData = {
  type: SystemEventType;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
};

export async function logEvent(event: CreateEventData): Promise<SystemEvent> {
  return prisma.systemEvent.create({
    data: {
      type: event.type,
      level: event.level,
      message: event.message,
      data: event.data ?? undefined,
    },
  });
}

export async function getRecentEvents(
  limit = 100,
  level?: LogLevel,
  type?: SystemEventType,
): Promise<SystemEvent[]> {
  return prisma.systemEvent.findMany({
    where: {
      ...(level ? { level } : {}),
      ...(type ? { type } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getEventsSince(since: Date): Promise<SystemEvent[]> {
  return prisma.systemEvent.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
  });
}
