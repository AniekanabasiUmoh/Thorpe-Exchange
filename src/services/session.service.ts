/**
 * Redis session service — Sprint 1.3
 *
 * TTL strategy:
 *   - Active conversation steps: 30-min TTL, reset on every user interaction
 *   - AWAITING_DEPOSIT: TTL dropped once transaction is confirmed in Breet (PROCESSING state)
 *     because Postgres owns that state — Redis session only needed for active conversation
 *   - COMPLETE / ERROR: session cleared immediately
 */
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getRedisClient } from '../db/redis.js';
import type { UserSession } from '../types/session.types.js';

const SESSION_TTL_SECONDS = 30 * 60; // 30 minutes
const KEY_PREFIX = 'session:';

export interface SessionService {
  getSession(userId: string, channel: 'whatsapp' | 'telegram'): Promise<UserSession>;
  setSession(userId: string, session: UserSession): Promise<void>;
  clearSession(userId: string): Promise<void>;
  extendSession(userId: string): Promise<void>;
  dropTtl(userId: string): Promise<void>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

let _sessionService: SessionService | null = null;

export function getSessionService(): SessionService {
  if (!_sessionService) {
    try {
      const redis = getRedisClient();
      _sessionService = new RedisSessionService(redis);
      logger.info('Session service: Redis');
    } catch (err) {
      if (env.NODE_ENV === 'production') {
        // In production, a missing Redis connection means sessions can't be shared
        // across instances — fail hard rather than silently degrade.
        logger.fatal({ err }, 'Redis unavailable in production — cannot start safely');
        process.exit(1);
      }
      logger.warn({ err }, 'Redis unavailable — using in-memory session fallback (dev only)');
      _sessionService = new InMemorySessionService();
    }
  }
  return _sessionService;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sessionKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function freshSession(userId: string, channel: 'whatsapp' | 'telegram'): UserSession {
  return {
    userId,
    channel,
    step: 'IDLE',
    lastMessageAt: new Date().toISOString(),
  };
}

// ─── Redis Implementation ─────────────────────────────────────────────────────

export class RedisSessionService implements SessionService {
  constructor(private readonly redis: Redis) { }

  async getSession(userId: string, channel: 'whatsapp' | 'telegram'): Promise<UserSession> {
    const raw = await this.redis.get(sessionKey(userId));
    if (!raw) {
      const session = freshSession(userId, channel);
      await this.setSession(userId, session);
      return session;
    }
    return JSON.parse(raw) as UserSession;
  }

  async setSession(userId: string, session: UserSession): Promise<void> {
    const updated: UserSession = {
      ...session,
      lastMessageAt: new Date().toISOString(),
    };
    await this.redis.setex(sessionKey(userId), SESSION_TTL_SECONDS, JSON.stringify(updated));
  }

  async clearSession(userId: string): Promise<void> {
    await this.redis.del(sessionKey(userId));
  }

  async extendSession(userId: string): Promise<void> {
    // Only extends TTL if the key exists — no-op if session already cleared
    await this.redis.expire(sessionKey(userId), SESSION_TTL_SECONDS);
  }

  /**
   * Remove TTL entirely — used when transaction enters PROCESSING state.
   * Postgres owns the state from this point; Redis session persists until explicitly cleared.
   */
  async dropTtl(userId: string): Promise<void> {
    await this.redis.expire(sessionKey(userId), 24 * 60 * 60); // Max 24h
  }
}

// ─── In-Memory Fallback ───────────────────────────────────────────────────────
// Single-instance only. Acceptable during Redis recovery window.
// Sessions are NOT shared across processes — do NOT rely on this in multi-instance deployments.

type InMemoryEntry = { session: UserSession; expiresAt: number | null };

export class InMemorySessionService implements SessionService {
  private readonly store = new Map<string, InMemoryEntry>();

  constructor() {
    // Prune expired sessions every 5 minutes to prevent memory leak
    setInterval(() => { this.prune(); }, 5 * 60 * 1000).unref();
  }

  async getSession(userId: string, channel: 'whatsapp' | 'telegram'): Promise<UserSession> {
    const entry = this.store.get(userId);
    if (!entry || this.isExpired(entry)) {
      const session = freshSession(userId, channel);
      await this.setSession(userId, session);
      return session;
    }
    return entry.session;
  }

  async setSession(userId: string, session: UserSession): Promise<void> {
    this.store.set(userId, {
      session: { ...session, lastMessageAt: new Date().toISOString() },
      expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
    });
  }

  async clearSession(userId: string): Promise<void> {
    this.store.delete(userId);
  }

  async extendSession(userId: string): Promise<void> {
    const entry = this.store.get(userId);
    if (entry && !this.isExpired(entry)) {
      entry.expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
    }
  }

  async dropTtl(userId: string): Promise<void> {
    const entry = this.store.get(userId);
    if (entry) {
      entry.expiresAt = Date.now() + 24 * 60 * 60 * 1000; // Max 24h cap
    }
  }

  private isExpired(entry: InMemoryEntry): boolean {
    if (entry.expiresAt === null) return false;
    return Date.now() > entry.expiresAt;
  }

  private prune(): void {
    const now = Date.now();
    for (const [userId, entry] of this.store) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.store.delete(userId);
      }
    }
  }
}
