/**
 * Engine integration tests — Sprint 6.3
 * Tests the core state machine against InMemorySessionService and MockBreetService.
 * No DB or Redis required. DB calls are mocked at the module level.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEngine } from '../bot/engine.js';
import { InMemorySessionService } from '../services/session.service.js';
import { createBreetService } from '../services/breet.service.js';
import type { NotificationService } from '../services/notification.service.js';
import type { BotResponse } from '../types/session.types.js';

// ─── Mock DB queries so engine tests don't need a real DB ─────────────────────

vi.mock('../db/db.queries.js', () => ({
    createOrFindUser: vi.fn().mockResolvedValue({
        id: 'db-user-1',
        is_blocked: false,
        whatsapp_number: null,
        telegram_id: 'tg-user-1',
        block_reason: null,
    }),
    getActiveTransaction: vi.fn().mockResolvedValue(null),
    createTransaction: vi.fn().mockResolvedValue({
        id: 'tx-1',
        idempotency_key: 'ik-1',
        status: 'PENDING',
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
    updateTransactionStatus: vi.fn().mockResolvedValue(undefined),
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    getUserDailyVolumeNGN: vi.fn().mockResolvedValue(0),
}));

vi.mock('../db/db.js', () => ({
    withTransaction: vi.fn().mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => fn({})),
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

function mockNotificationService(): NotificationService & { sent: BotResponse[] } {
    const sent: BotResponse[] = [];
    return {
        sent,
        async send({ message }) {
            sent.push(message);
        },
    };
}

function buildEngine() {
    // Force mock mode
    process.env['BREET_MOCK'] = 'true';
    const breetService = createBreetService();
    const sessionService = new InMemorySessionService();
    const notificationService = mockNotificationService();
    const engine = createEngine({ sessionService, breetService, notificationService });
    return { engine, sessionService, notificationService };
}

const USER = { userId: 'tg-user-1', channel: 'telegram' as const };

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('Engine — happy path', () => {
    let engine: ReturnType<typeof buildEngine>['engine'];

    beforeEach(() => {
        vi.clearAllMocks();
        ({ engine } = buildEngine());
    });

    it('IDLE: greets user and prompts to sell', async () => {
        const res = await engine.handleMessage({ ...USER, text: 'hello' });
        expect(res.text).toContain('sell');
    });

    it('IDLE: responds to "sell" with amount prompt', async () => {
        const res = await engine.handleMessage({ ...USER, text: 'sell' });
        expect(res.text).toContain('USDT');
    });

    it('AWAITING_AMOUNT: accepts valid amount and shows bank keyboard', async () => {
        await engine.handleMessage({ ...USER, text: 'sell' });
        const res = await engine.handleMessage({ ...USER, text: '100' });
        expect(res.text).toContain('₦');
        expect(res.keyboard).toBeDefined();
        expect(res.keyboard?.type).toBe('inline');
    });

    it('AWAITING_BANK: accepts bank selection and prompts for account number', async () => {
        await engine.handleMessage({ ...USER, text: 'sell' });
        await engine.handleMessage({ ...USER, text: '100' });
        const res = await engine.handleMessage({
            ...USER,
            text: '',
            callbackData: 'bank:044:Access Bank',
        });
        expect(res.text.toLowerCase()).toContain('account');
    });

    it('AWAITING_ACCOUNT: resolves account and shows confirmation', async () => {
        await engine.handleMessage({ ...USER, text: 'sell' });
        await engine.handleMessage({ ...USER, text: '100' });
        await engine.handleMessage({ ...USER, text: '', callbackData: 'bank:044:Access Bank' });
        const res = await engine.handleMessage({ ...USER, text: '0123456789' });
        expect(res.text.toLowerCase()).toContain('correct');
        expect(res.keyboard?.type).toBe('inline');
    });

    it('AWAITING_CONFIRMATION: "yes" generates deposit address', async () => {
        await engine.handleMessage({ ...USER, text: 'sell' });
        await engine.handleMessage({ ...USER, text: '100' });
        await engine.handleMessage({ ...USER, text: '', callbackData: 'bank:044:Access Bank' });
        await engine.handleMessage({ ...USER, text: '0123456789' });
        const res = await engine.handleMessage({ ...USER, text: '', callbackData: 'confirm:yes' });
        expect(res.text).toContain('TRC20');
    });
});

// ─── Cancel at every step ─────────────────────────────────────────────────────

describe('Engine — cancel command', () => {
    let engine: ReturnType<typeof buildEngine>['engine'];

    beforeEach(() => {
        vi.clearAllMocks();
        ({ engine } = buildEngine());
    });

    it('cancel from IDLE returns "nothing to cancel"', async () => {
        const res = await engine.handleMessage({ ...USER, text: 'cancel' });
        expect(res.text.toLowerCase()).toContain('cancel');
    });

    it('cancel from AWAITING_AMOUNT resets session', async () => {
        await engine.handleMessage({ ...USER, text: 'sell' });
        const res = await engine.handleMessage({ ...USER, text: 'cancel' });
        expect(res.text.toLowerCase()).toContain('cancel');
    });

    it('cancel from AWAITING_BANK resets session', async () => {
        await engine.handleMessage({ ...USER, text: 'sell' });
        await engine.handleMessage({ ...USER, text: '100' });
        const res = await engine.handleMessage({ ...USER, text: 'cancel' });
        expect(res.text.toLowerCase()).toContain('cancel');
    });
});

// ─── Input validation ─────────────────────────────────────────────────────────

describe('Engine — input validation', () => {
    let engine: ReturnType<typeof buildEngine>['engine'];

    beforeEach(() => {
        vi.clearAllMocks();
        ({ engine } = buildEngine());
    });

    it('rejects non-numeric amount', async () => {
        await engine.handleMessage({ ...USER, text: 'sell' });
        const res = await engine.handleMessage({ ...USER, text: 'abc' });
        expect(res.text.toLowerCase()).toContain('valid');
    });

    it('rejects amount below minimum', async () => {
        await engine.handleMessage({ ...USER, text: 'sell' });
        const res = await engine.handleMessage({ ...USER, text: '0.01' });
        expect(res.text.toLowerCase()).toContain('minimum');
    });

    it('rejects amount above maximum', async () => {
        await engine.handleMessage({ ...USER, text: 'sell' });
        const res = await engine.handleMessage({ ...USER, text: '999999' });
        expect(res.text.toLowerCase()).toContain('maximum');
    });

    it('rejects account number that is not 10 digits', async () => {
        await engine.handleMessage({ ...USER, text: 'sell' });
        await engine.handleMessage({ ...USER, text: '100' });
        await engine.handleMessage({ ...USER, text: '', callbackData: 'bank:044:Access Bank' });
        const res = await engine.handleMessage({ ...USER, text: '123' });
        expect(res.text.toLowerCase()).toContain('account');
    });
});

// ─── Blocked user ─────────────────────────────────────────────────────────────

describe('Engine — blocked user', () => {
    it('blocked user receives blocked message immediately', async () => {
        const { createOrFindUser } = await import('../db/db.queries.js');
        vi.mocked(createOrFindUser).mockResolvedValueOnce({
            id: 'blocked-user',
            is_blocked: true,
            telegram_id: 'tg-blocked',
            whatsapp_number: null,
            block_reason: 'Fraud',
        });

        const { engine } = buildEngine();
        const res = await engine.handleMessage({ ...USER, text: 'sell' });
        expect(res.text.toLowerCase()).toContain('suspend');
    });
});

// ─── Session isolation ────────────────────────────────────────────────────────

describe('Engine — session isolation', () => {
    it('two users have independent sessions', async () => {
        vi.clearAllMocks();
        const { engine } = buildEngine();

        const user1 = { userId: 'user-1', channel: 'telegram' as const };
        const user2 = { userId: 'user-2', channel: 'telegram' as const };

        await engine.handleMessage({ ...user1, text: 'sell' });
        await engine.handleMessage({ ...user1, text: '100' });

        // User 2 starts fresh — should see welcome
        const res2 = await engine.handleMessage({ ...user2, text: 'hello' });
        expect(res2.text).toContain('sell');
    });
});
