/**
 * Redis session service.
 * Sprint 1.3 — full implementation.
 * Stub only.
 */
import type { UserSession } from '../types/session.types.js';

export interface SessionService {
  getSession(userId: string, channel: 'whatsapp' | 'telegram'): Promise<UserSession>;
  setSession(userId: string, session: UserSession): Promise<void>;
  clearSession(userId: string): Promise<void>;
  extendSession(userId: string): Promise<void>;
  dropTtl(userId: string): Promise<void>; // Called when tx enters PROCESSING state
}

// TODO: Sprint 1.3 — implement RedisSessionService and InMemorySessionService (fallback)
export class RedisSessionService implements SessionService {
  async getSession(
    _userId: string,
    _channel: 'whatsapp' | 'telegram',
  ): Promise<UserSession> {
    throw new Error('RedisSessionService not yet implemented');
  }

  async setSession(_userId: string, _session: UserSession): Promise<void> {
    throw new Error('RedisSessionService not yet implemented');
  }

  async clearSession(_userId: string): Promise<void> {
    throw new Error('RedisSessionService not yet implemented');
  }

  async extendSession(_userId: string): Promise<void> {
    throw new Error('RedisSessionService not yet implemented');
  }

  async dropTtl(_userId: string): Promise<void> {
    throw new Error('RedisSessionService not yet implemented');
  }
}
