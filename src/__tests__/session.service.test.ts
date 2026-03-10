/**
 * Unit tests for session service — Sprint 1.3
 * Uses InMemorySessionService (no Redis needed) to test all core behaviours.
 * RedisSessionService tests use a mock Redis client.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InMemorySessionService, RedisSessionService } from '../services/session.service.js';
import type { UserSession } from '../types/session.types.js';

// ─── InMemorySessionService ────────────────────────────────────────────────────

describe('InMemorySessionService', () => {
  let svc: InMemorySessionService;

  beforeEach(() => {
    svc = new InMemorySessionService();
  });

  it('getSession — creates a fresh IDLE session if none exists', async () => {
    const session = await svc.getSession('user_1', 'telegram');
    expect(session.userId).toBe('user_1');
    expect(session.channel).toBe('telegram');
    expect(session.step).toBe('IDLE');
    expect(session.lastMessageAt).toBeDefined();
  });

  it('getSession — returns existing session on second call', async () => {
    await svc.getSession('user_1', 'telegram');

    const update: UserSession = {
      userId: 'user_1',
      channel: 'telegram',
      step: 'AWAITING_AMOUNT',
      quoteAmount: 100,
    };
    await svc.setSession('user_1', update);

    const retrieved = await svc.getSession('user_1', 'telegram');
    expect(retrieved.step).toBe('AWAITING_AMOUNT');
    expect(retrieved.quoteAmount).toBe(100);
  });

  it('setSession — saves session and stamps lastMessageAt', async () => {
    const before = new Date().toISOString();
    const session: UserSession = {
      userId: 'user_2',
      channel: 'whatsapp',
      step: 'AWAITING_BANK',
    };
    await svc.setSession('user_2', session);
    const retrieved = await svc.getSession('user_2', 'whatsapp');

    expect(retrieved.step).toBe('AWAITING_BANK');
    expect(retrieved.lastMessageAt).toBeDefined();
    expect(retrieved.lastMessageAt! >= before).toBe(true);
  });

  it('clearSession — removes session completely', async () => {
    await svc.setSession('user_3', { userId: 'user_3', channel: 'telegram', step: 'COMPLETE' });
    await svc.clearSession('user_3');

    // After clear, getSession should return fresh IDLE session
    const fresh = await svc.getSession('user_3', 'telegram');
    expect(fresh.step).toBe('IDLE');
  });

  it('extendSession — resets TTL on active session', async () => {
    await svc.getSession('user_4', 'telegram');

    // Manually set a near-expired TTL
    const entry = (svc as unknown as { store: Map<string, { session: UserSession; expiresAt: number | null }> })
      .store.get('user_4');
    expect(entry).toBeDefined();
    const oldExpiry = entry!.expiresAt!;
    entry!.expiresAt = Date.now() + 1000; // 1 second

    await svc.extendSession('user_4');

    const newExpiry = entry!.expiresAt!;
    expect(newExpiry).toBeGreaterThan(oldExpiry - 1000); // extended
  });

  it('dropTtl — removes expiry so session lives forever', async () => {
    await svc.getSession('user_5', 'telegram');
    await svc.dropTtl('user_5');

    const entry = (svc as unknown as { store: Map<string, { session: UserSession; expiresAt: number | null }> })
      .store.get('user_5');
    expect(entry?.expiresAt).toBeNull();
  });

  it('expired session — returns fresh IDLE session after TTL passes', async () => {
    await svc.setSession('user_6', { userId: 'user_6', channel: 'telegram', step: 'AWAITING_AMOUNT' });

    // Manually expire
    const entry = (svc as unknown as { store: Map<string, { session: UserSession; expiresAt: number | null }> })
      .store.get('user_6');
    entry!.expiresAt = Date.now() - 1; // already expired

    const fresh = await svc.getSession('user_6', 'telegram');
    expect(fresh.step).toBe('IDLE');
  });

  it('session with dropTtl — does not expire', async () => {
    await svc.setSession('user_7', { userId: 'user_7', channel: 'telegram', step: 'AWAITING_DEPOSIT' });
    await svc.dropTtl('user_7');

    // Simulate time passing past normal TTL
    const entry = (svc as unknown as { store: Map<string, { session: UserSession; expiresAt: number | null }> })
      .store.get('user_7');
    // expiresAt is null — session should NOT be treated as expired
    expect(entry?.expiresAt).toBeNull();

    const retrieved = await svc.getSession('user_7', 'telegram');
    expect(retrieved.step).toBe('AWAITING_DEPOSIT'); // still intact
  });

  it('independent sessions — different users do not bleed', async () => {
    await svc.setSession('user_a', { userId: 'user_a', channel: 'telegram', step: 'AWAITING_BANK' });
    await svc.setSession('user_b', { userId: 'user_b', channel: 'whatsapp', step: 'AWAITING_AMOUNT' });

    const a = await svc.getSession('user_a', 'telegram');
    const b = await svc.getSession('user_b', 'whatsapp');

    expect(a.step).toBe('AWAITING_BANK');
    expect(b.step).toBe('AWAITING_AMOUNT');
    expect(a.userId).not.toBe(b.userId);
  });
});

// ─── RedisSessionService (mocked Redis) ────────────────────────────────────────

describe('RedisSessionService', () => {
  const mockRedis = {
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    expire: vi.fn(),
    persist: vi.fn(),
  };

  let svc: RedisSessionService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new RedisSessionService(mockRedis as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getSession — returns parsed session from Redis', async () => {
    const stored: UserSession = { userId: 'u1', channel: 'telegram', step: 'AWAITING_BANK' };
    mockRedis.get.mockResolvedValue(JSON.stringify(stored));

    const result = await svc.getSession('u1', 'telegram');
    expect(result.step).toBe('AWAITING_BANK');
    expect(mockRedis.get).toHaveBeenCalledWith('session:u1');
  });

  it('getSession — creates and saves fresh session if Redis returns null', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');

    const result = await svc.getSession('u2', 'whatsapp');
    expect(result.step).toBe('IDLE');
    expect(result.channel).toBe('whatsapp');
    expect(mockRedis.setex).toHaveBeenCalledOnce();
  });

  it('setSession — calls setex with correct TTL', async () => {
    mockRedis.setex.mockResolvedValue('OK');

    const session: UserSession = { userId: 'u3', channel: 'telegram', step: 'AWAITING_AMOUNT' };
    await svc.setSession('u3', session);

    expect(mockRedis.setex).toHaveBeenCalledWith(
      'session:u3',
      30 * 60,
      expect.stringContaining('"step":"AWAITING_AMOUNT"'),
    );
  });

  it('clearSession — calls del with correct key', async () => {
    mockRedis.del.mockResolvedValue(1);
    await svc.clearSession('u4');
    expect(mockRedis.del).toHaveBeenCalledWith('session:u4');
  });

  it('extendSession — calls expire with correct TTL', async () => {
    mockRedis.expire.mockResolvedValue(1);
    await svc.extendSession('u5');
    expect(mockRedis.expire).toHaveBeenCalledWith('session:u5', 30 * 60);
  });

  it('dropTtl — calls persist to remove expiry', async () => {
    mockRedis.persist.mockResolvedValue(1);
    await svc.dropTtl('u6');
    expect(mockRedis.persist).toHaveBeenCalledWith('session:u6');
  });
});
