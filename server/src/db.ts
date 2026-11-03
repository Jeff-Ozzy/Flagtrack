import { PrismaClient } from '@prisma/client';
import './config';

export const prisma = new PrismaClient();

/** Trusted server clock. Replaceable in tests; never derived from the client. */
export const clock = { now: () => new Date() };
