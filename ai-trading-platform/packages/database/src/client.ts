import { PrismaClient } from '@prisma/client';

// =============================================================================
// PRISMA CLIENT SINGLETON
// Prevents multiple connections during hot-reload in development.
// In production a single instance is created and reused.
// =============================================================================

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env['NODE_ENV'] === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
    errorFormat: 'minimal',
  });
}

export const prisma: PrismaClient =
  globalThis.__prisma ?? createPrismaClient();

if (process.env['NODE_ENV'] !== 'production') {
  globalThis.__prisma = prisma;
}

/**
 * Connect to the database.
 * Call once at application startup.
 */
export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
}

/**
 * Disconnect from the database.
 * Call during graceful shutdown.
 */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Health check — returns true if the database is reachable.
 */
export async function isDatabaseHealthy(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
