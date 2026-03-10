/**
 * Shared Redis Client — Sprint 6.1 Hardening
 *
 * Provides a single Redis connection pool to be shared across session service,
 * rate limiter, and cron jobs. This prevents hitting the 100-connection limit
 * on Upstash's free tier.
 */
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let sharedRedisClient: Redis | null = null;

export function getRedisClient(): Redis {
    if (!sharedRedisClient) {
        sharedRedisClient = new Redis(env.REDIS_URL, {
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            lazyConnect: false,
            enableReadyCheck: true,
        });

        sharedRedisClient.on('error', (err: Error) => {
            logger.error({ err }, 'Shared Redis error');
        });

        sharedRedisClient.on('connect', () => {
            logger.info('Shared Redis connected successfully');
        });
    }
    return sharedRedisClient;
}
