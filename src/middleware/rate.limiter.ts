/**
 * Redis-based Rate Limiter — Phase 6 Hardening
 *
 * Implements a sliding window rate limiter to prevent spam attacks
 * or accidental tight-loops from messaging platforms.
 */
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getRedisClient } from '../db/redis.js';

/**
 * Checks if a user has exceeded their message rate limit.
 *
 * @param userId - The user's ID
 * @param channel - The channel they are messaging from
 * @returns true if they are allowed (below limit), false if blocked (rate limited)
 */
export async function checkRateLimit(
    userId: string,
    channel: 'whatsapp' | 'telegram',
): Promise<boolean> {
    // Always fail-open in test environments or if Redis is somehow unavailable
    if (env.NODE_ENV === 'test') return true;

    const maxMessages = env.MAX_MESSAGES_PER_MINUTE;
    const windowSeconds = 60;

    const key = `ratelimit:${channel}:${userId}`;
    const now = Date.now();

    try {
        const redis = getRedisClient();

        // ZSET: score is timestamp, value is timestamp-random (to be unique)
        const pipeline = redis.pipeline();
        pipeline.zremrangebyscore(key, 0, now - windowSeconds * 1000); // Remove entries older than 60s
        pipeline.zcard(key);                                           // Count remaining
        pipeline.zadd(key, now, `${now}-${Math.random()}`);            // Add current message
        pipeline.expire(key, windowSeconds);                           // Keep key from living forever

        const results = await pipeline.exec();
        if (!results) return true; // fail-open

        // result[1] is the result of zcard
        const [zcardErr, zcardCount] = results[1] as [Error | null, number];
        if (zcardErr) throw zcardErr;

        if (zcardCount >= maxMessages) {
            logger.warn({ userId, channel, maxMessages }, 'User rate-limited');
            return false; // Blocked
        }

        return true; // Allowed
    } catch (err) {
        logger.error({ err, userId }, 'Rate limiter failed, allowing request (fail-open)');
        return true;
    }
}
