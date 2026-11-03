import { PrismaClient } from '@prisma/client';
import './config';
import { createMemoryPrisma } from './local-db/memory';

/**
 * DB_DRIVER=memory runs the API on the in-memory engine used by the offline
 * mode (the integration suite runs against both drivers).
 */
export const prisma: PrismaClient = process.env.DB_DRIVER === 'memory' ? (createMemoryPrisma() as unknown as PrismaClient) : new PrismaClient();

/** Trusted server clock. Replaceable in tests; never derived from the client. */
export const clock = { now: () => new Date() };
