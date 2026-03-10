/**
 * Conversation engine — Sprint 3.1
 *
 * The single brain of the bot. Every channel (Telegram, WhatsApp) calls
 * handleMessage() with the same shape. Channel-specific formatting is the
 * channel adapter's responsibility.
 *
 * State machine:
 *   IDLE → AWAITING_AMOUNT → AWAITING_BANK → AWAITING_ACCOUNT
 *        → AWAITING_CONFIRMATION → AWAITING_DEPOSIT → COMPLETE
 *
 * Global commands checked before step dispatch:
 *   cancel, status, help, support
 */
import { env } from '../config/env.js';
import { RateService } from '../services/rate.service.js';
import type { SessionService } from '../services/session.service.js';
import type { BreetService } from '../types/breet.types.js';
import type { NotificationService } from '../services/notification.service.js';
import type { UserSession, BotResponse } from '../types/session.types.js';
import { messages, fillTemplate } from '../copy/messages.js';
import { logger } from '../utils/logger.js';
import { withTransaction } from '../db/db.js';
import {
    createOrFindUser,
    getActiveTransaction,
    createTransaction,
    updateTransactionStatus,
    writeAuditLog,
    getUserDailyVolumeNGN,
} from '../db/db.queries.js';

// ─── Engine input / output types ──────────────────────────────────────────────

export type HandleMessageParams = {
    /** Unique identifier for the user on their channel */
    userId: string;
    channel: 'whatsapp' | 'telegram';
    text: string;
    /** Telegram inline keyboard callback data */
    callbackData?: string;
};

// ─── Engine factory ───────────────────────────────────────────────────────────

export type EngineServices = {
    sessionService: SessionService;
    breetService: BreetService;
    notificationService: NotificationService;
};

export function createEngine(services: EngineServices) {
    const rateService = new RateService(services.breetService);
    return { handleMessage: handleMessage.bind(null, services, rateService) };
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

async function handleMessage(
    services: EngineServices,
    rateService: RateService,
    params: HandleMessageParams,
): Promise<BotResponse> {
    const { userId, channel } = params;
    const text = params.text.trim().toLowerCase();

    try {
        // Ensure user record exists in DB
        const dbUser = await createOrFindUser(channel, userId);

        // Blocked user check — before anything else
        if (dbUser.is_blocked) {
            logger.warn({ userId, channel }, 'Blocked user attempted message');
            return respond(messages.blocked);
        }

        const session = await services.sessionService.getSession(userId, channel);

        // ── Global commands ──────────────────────────────────────────────────────

        if (text === 'cancel') {
            return await handleCancel(services, session, dbUser.id);
        }

        if (text === 'status') {
            return await handleStatus(dbUser.id);
        }

        if (text === 'help') {
            return respond(messages.help);
        }

        if (text === 'support' || text === 'agent') {
            return await handleSupportEscalation(services, session, dbUser.id);
        }

        // ── Step dispatch ────────────────────────────────────────────────────────
        // Extend session TTL on every active interaction
        await services.sessionService.extendSession(userId);

        switch (session.step) {
            case 'IDLE':
                return await handleIdle(services, rateService, session, params, dbUser.id);

            case 'AWAITING_AMOUNT':
                return await handleAmount(services, rateService, session, params, dbUser.id);

            case 'AWAITING_BANK':
                return await handleBank(services, session, params, dbUser.id);

            case 'AWAITING_ACCOUNT':
                return await handleAccount(services, session, params, dbUser.id);

            case 'AWAITING_CONFIRMATION':
                return await handleConfirmation(services, rateService, session, params, dbUser.id);

            case 'AWAITING_DEPOSIT':
                return await handleDepositReminder(session);

            case 'SUPPORT':
                return respond(messages.supportEscalated.replace('{{contact}}', env.SUPPORT_CONTACT ?? 'our team'));

            case 'COMPLETE':
            case 'ERROR':
                return respond(`${messages.statusNone}\n\nType *sell* to start a new transaction.`);

            default:
                return respond(messages.help);
        }
    } catch (err) {
        logger.error({ err, userId, channel }, 'Unhandled error in handleMessage');
        return respond(messages.genericError);
    }
}

// ─── Step: IDLE ───────────────────────────────────────────────────────────────

async function handleIdle(
    services: EngineServices,
    rateService: RateService,
    session: UserSession,
    params: HandleMessageParams,
    dbUserId: string,
): Promise<BotResponse> {
    const text = params.text.trim().toLowerCase();

    if (text === 'start' || text === '/start') {
        return respond(messages.welcome);
    }

    if (text !== 'sell') {
        return respond(messages.welcome);
    }

    // User said "sell" — check for pending transaction first
    const pending = await getActiveTransaction(dbUserId);
    if (pending) {
        return respond(messages.pendingTransaction);
    }

    // Fetch limits from Breet to embed in the prompt
    const limits = await services.breetService.getLimits().catch(() => ({
        minAmount: env.MIN_TX_AMOUNT,
        maxAmount: env.MAX_TX_AMOUNT,
    }));
    const { minAmount, maxAmount } = limits;

    await services.sessionService.setSession(params.userId, {
        ...session,
        step: 'AWAITING_AMOUNT',
    });

    return respond(
        fillTemplate(messages.askAmount, {
            min: minAmount ?? env.MIN_TX_AMOUNT,
            max: maxAmount ?? env.MAX_TX_AMOUNT,
        }),
    );
}

// ─── Step: AWAITING_AMOUNT ────────────────────────────────────────────────────

async function handleAmount(
    services: EngineServices,
    rateService: RateService,
    session: UserSession,
    params: HandleMessageParams,
    dbUserId: string,
): Promise<BotResponse> {
    const raw = params.text.replace(/[^0-9.]/g, '');
    const amount = parseFloat(raw);

    if (isNaN(amount) || amount <= 0) {
        return respond(messages.invalidAmount);
    }

    if (amount < env.MIN_TX_AMOUNT) {
        return respond(fillTemplate(messages.amountTooLow, { min: env.MIN_TX_AMOUNT }));
    }

    if (amount > env.MAX_TX_AMOUNT) {
        return respond(fillTemplate(messages.amountTooHigh, { max: env.MAX_TX_AMOUNT }));
    }

    // Daily volume limit check
    const dailyVolume = await getUserDailyVolumeNGN(dbUserId);
    if (dailyVolume >= env.MAX_DAILY_VOLUME_NGN) {
        return respond(messages.volumeLimitReached);
    }

    // Get quote with spread applied
    const quote = await rateService.getQuote(amount);

    await services.sessionService.setSession(params.userId, {
        ...session,
        step: 'AWAITING_BANK',
        quoteAmount: amount,
        quotedRate: quote.displayRate,
        rawBreetRate: quote.rawRate,
        serviceMargin: quote.serviceMarginTotal,
        quoteExpiresAt: quote.expiresAt,
    });

    // Fetch banks for keyboard
    const banks = await services.breetService.getBanks();

    const bankKeyboard = buildBankKeyboard(banks);

    return {
        text: fillTemplate(messages.askBank, {
            naira: RateService.formatNGN(quote.fiatAmount),
        }),
        keyboard: bankKeyboard,
        parseMode: 'Markdown',
    };
}

// ─── Step: AWAITING_BANK ─────────────────────────────────────────────────────

async function handleBank(
    services: EngineServices,
    session: UserSession,
    params: HandleMessageParams,
    _dbUserId: string,
): Promise<BotResponse> {
    const input = (params.callbackData ?? params.text).trim();

    // Accept callback like "bank:044:Access Bank" or free text bank name
    let bankCode: string;
    let bankName: string;

    if (input.startsWith('bank:')) {
        const parts = input.split(':');
        bankCode = parts[1] ?? '';
        bankName = parts.slice(2).join(':');
    } else {
        // Try to match by name or code from known banks
        const banks = await services.breetService.getBanks();
        const match = banks.find(
            (b) =>
                b.code === input ||
                b.name.toLowerCase() === input.toLowerCase(),
        );

        if (!match) {
            const banks2 = await services.breetService.getBanks();
            return {
                text: `I didn't recognise that bank. Please select one from the list.`,
                keyboard: buildBankKeyboard(banks2),
            };
        }
        bankCode = match.code;
        bankName = match.name;
    }

    await services.sessionService.setSession(params.userId, {
        ...session,
        step: 'AWAITING_ACCOUNT',
        selectedBank: { code: bankCode, name: bankName },
    });

    return respond(
        fillTemplate(messages.askAccount, { bankName }),
        'Markdown',
    );
}

// ─── Step: AWAITING_ACCOUNT ───────────────────────────────────────────────────

async function handleAccount(
    services: EngineServices,
    session: UserSession,
    params: HandleMessageParams,
    dbUserId: string,
): Promise<BotResponse> {
    const accountNumber = params.text.replace(/\D/g, '').trim();

    if (accountNumber.length !== 10) {
        return respond(messages.invalidAccount);
    }

    const bank = session.selectedBank;
    if (!bank) {
        // Shouldn't happen — reset
        await services.sessionService.clearSession(params.userId);
        return respond(messages.genericError);
    }

    const retryCount = (session.retryCount ?? 0) + 1;

    try {
        const { accountName } = await services.breetService.resolveAccount(
            bank.code,
            accountNumber,
        );

        await services.sessionService.setSession(params.userId, {
            ...session,
            step: 'AWAITING_CONFIRMATION',
            accountNumber,
            accountName,
            retryCount: 0,
        });

        await writeAuditLog('ACCOUNT_RESOLVED', 'bot', {
            userId: dbUserId,
            payload: { bank: bank.code, account: accountNumber },
        });

        return {
            text: fillTemplate(messages.confirmAccount, {
                accountName,
                bankName: bank.name,
                accountNumber,
            }),
            keyboard: yesNoKeyboard(),
            parseMode: 'Markdown',
        };
    } catch {
        if (retryCount >= 3) {
            await services.sessionService.clearSession(params.userId);
            await writeAuditLog('ACCOUNT_RESOLVE_FAILED_MAX_RETRIES', 'bot', { userId: dbUserId });
            return respond(messages.accountMaxRetries);
        }

        await services.sessionService.setSession(params.userId, {
            ...session,
            retryCount,
        });

        return respond(
            fillTemplate(messages.accountNotFound, { attempt: retryCount }),
        );
    }
}

// ─── Step: AWAITING_CONFIRMATION ─────────────────────────────────────────────

async function handleConfirmation(
    services: EngineServices,
    rateService: RateService,
    session: UserSession,
    params: HandleMessageParams,
    dbUserId: string,
): Promise<BotResponse> {
    const input = (params.callbackData ?? params.text).trim().toLowerCase();

    if (input === 'no' || input === 'confirm:no') {
        await services.sessionService.clearSession(params.userId);
        return respond(messages.cancelled);
    }

    if (input !== 'yes' && input !== 'confirm:yes') {
        return {
            text: 'Please confirm with Yes or No.',
            keyboard: yesNoKeyboard(),
        };
    }

    // ── Rate expiry check ────────────────────────────────────────────────────
    if (session.quoteExpiresAt && RateService.isExpired(session.quoteExpiresAt)) {
        // Re-quote with fresh rate
        const newQuote = await rateService.getQuote(session.quoteAmount ?? 0);

        await services.sessionService.setSession(params.userId, {
            ...session,
            quotedRate: newQuote.displayRate,
            rawBreetRate: newQuote.rawRate,
            serviceMargin: newQuote.serviceMarginTotal,
            quoteExpiresAt: newQuote.expiresAt,
        });

        await writeAuditLog('RATE_EXPIRED_REQUOTE', 'system', {
            userId: dbUserId,
            payload: { oldRate: session.quotedRate, newRate: newQuote.displayRate },
        });

        return {
            text: fillTemplate(messages.rateExpired, {
                amount: session.quoteAmount ?? 0,
                naira: RateService.formatNGN(newQuote.fiatAmount),
                rate: RateService.formatNGN(newQuote.displayRate),
            }),
            keyboard: yesNoKeyboard(),
            parseMode: 'Markdown',
        };
    }

    // ── Initiate offramp ─────────────────────────────────────────────────────
    const {
        quoteAmount = 0,
        quotedRate = 0,
        rawBreetRate = 0,
        serviceMargin = 0,
        quoteExpiresAt,
        selectedBank,
        accountNumber = '',
        accountName = '',
    } = session;

    const fiatAmount = parseFloat((quoteAmount * quotedRate).toFixed(2));
    const expiresAt = new Date(quoteExpiresAt ?? Date.now() + 10 * 60_000);

    let txRecord: Awaited<ReturnType<typeof createTransaction>>;
    let depositAddress: string;
    let breetTxId: string;

    try {
        // Create transaction in DB first (idempotency key generated by DB)
        txRecord = await createTransaction({
            userId: dbUserId,
            assetAmount: quoteAmount,
            fiatAmount,
            lockedRate: quotedRate,
            rawBreetRate,
            serviceMargin,
            rateLocketAt: new Date(),
            expiresAt,
            payoutBankCode: selectedBank?.code ?? '',
            payoutAccount: accountNumber,
            payoutAccountName: accountName,
        });

        // Initiate with Breet
        const breetResult = await services.breetService.initiateOfframp({
            amount: quoteAmount,
            bankCode: selectedBank?.code ?? '',
            accountNumber,
            idempotencyKey: txRecord.idempotency_key,
        });

        depositAddress = breetResult.depositAddress;
        breetTxId = breetResult.transactionId;

        // Update DB with Breet details
        await updateTransactionStatus(txRecord.id, 'AWAITING_DEPOSIT', {
            breetTransactionId: breetTxId,
            depositAddress,
        });

        await writeAuditLog('RATE_LOCKED', 'bot', {
            transactionId: txRecord.id,
            userId: dbUserId,
            payload: { rate: quotedRate, amount: quoteAmount, fiatAmount },
        });

        await writeAuditLog('ADDRESS_GENERATED', 'breet', {
            transactionId: txRecord.id,
            userId: dbUserId,
            payload: { depositAddress, breetTxId },
        });
    } catch (err) {
        logger.error({ err, userId: params.userId }, 'initiateOfframp failed');
        await services.sessionService.clearSession(params.userId);
        return respond(messages.genericError);
    }

    // Drop TTL while user is waiting for deposit — Postgres owns state now
    await services.sessionService.dropTtl(params.userId);

    await services.sessionService.setSession(params.userId, {
        ...session,
        step: 'AWAITING_DEPOSIT',
        transactionId: txRecord.id,
        depositAddress,
    });

    const minutesRemaining = RateService.minutesRemaining(
        new Date(expiresAt).toISOString(),
    );

    return {
        text: fillTemplate(messages.depositReady, {
            address: depositAddress,
            amount: quoteAmount,
            minutes: minutesRemaining,
        }),
        parseMode: 'Markdown',
    };
}

// ─── Step: AWAITING_DEPOSIT ───────────────────────────────────────────────────

async function handleDepositReminder(session: UserSession): Promise<BotResponse> {
    if (!session.depositAddress) {
        return respond(messages.genericError);
    }

    // Warn if they try to start a new sell
    return {
        text: fillTemplate(messages.depositReady, {
            address: session.depositAddress,
            amount: session.quoteAmount ?? 0,
            minutes: session.quoteExpiresAt
                ? RateService.minutesRemaining(session.quoteExpiresAt)
                : '?',
        }) + '\n\n_Waiting for your deposit…_',
        parseMode: 'Markdown',
    };
}

// ─── Global: CANCEL ───────────────────────────────────────────────────────────

async function handleCancel(
    services: EngineServices,
    session: UserSession,
    dbUserId: string,
): Promise<BotResponse> {
    if (session.step === 'IDLE' || session.step === 'COMPLETE' || session.step === 'ERROR') {
        return respond(messages.nothingToCancel);
    }

    if (session.transactionId) {
        await updateTransactionStatus(session.transactionId, 'FAILED', {
            failureReason: 'Cancelled by user',
        });
        await writeAuditLog('USER_CANCELLED', 'user', {
            transactionId: session.transactionId,
            userId: dbUserId,
        });
    }

    await services.sessionService.clearSession(session.userId);
    return respond(messages.cancelled);
}

// ─── Global: STATUS ───────────────────────────────────────────────────────────

async function handleStatus(dbUserId: string): Promise<BotResponse> {
    const tx = await getActiveTransaction(dbUserId);

    if (!tx) {
        return respond(messages.statusNone);
    }

    return respond(
        fillTemplate(messages.statusActive, {
            txId: tx.id.slice(0, 8),
            status: tx.status,
            amount: tx.asset_amount,
            expiry: tx.expires_at
                ? new Date(tx.expires_at).toLocaleTimeString()
                : 'N/A',
        }),
        'Markdown',
    );
}

// ─── Global: SUPPORT ─────────────────────────────────────────────────────────

async function handleSupportEscalation(
    services: EngineServices,
    session: UserSession,
    dbUserId: string,
): Promise<BotResponse> {
    await services.sessionService.setSession(session.userId, {
        ...session,
        step: 'SUPPORT',
    });

    await writeAuditLog('SUPPORT_ESCALATED', 'user', {
        transactionId: session.transactionId ?? undefined,
        userId: dbUserId,
    });

    const contact = env.SUPPORT_CONTACT ?? 'our team';
    return respond(
        fillTemplate(messages.supportEscalated, { contact }),
        'Markdown',
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function respond(text: string, parseMode: 'Markdown' | 'HTML' = 'Markdown'): BotResponse {
    return { text, parseMode };
}

function yesNoKeyboard() {
    return {
        type: 'inline' as const,
        buttons: [
            [
                { text: '✅ Yes', callbackData: 'confirm:yes' },
                { text: '❌ No', callbackData: 'confirm:no' },
            ],
        ],
    };
}

function buildBankKeyboard(banks: Array<{ code: string; name: string }>) {
    // Two banks per row
    const rows: Array<Array<{ text: string; callbackData: string }>> = [];
    for (let i = 0; i < banks.length; i += 2) {
        const row = banks.slice(i, i + 2).map((b) => ({
            text: b.name,
            callbackData: `bank:${b.code}:${b.name}`,
        }));
        rows.push(row);
    }
    return { type: 'inline' as const, buttons: rows };
}
