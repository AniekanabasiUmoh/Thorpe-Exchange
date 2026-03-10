/**
 * Breet service — Sprint 2.1
 *
 * Exports:
 *   createBreetService() → MockBreetService | RealBreetService
 *
 * RealBreetService features:
 *   - Retry: up to 3 attempts with exponential backoff on 5xx. Never retries 4xx.
 *   - Circuit breaker: opens after 5 consecutive failures, resets after 60s.
 *     While open, calls fail immediately with BREET_CIRCUIT_OPEN error.
 */
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { AppError, ErrorCode } from '../utils/errors.js';
import type { BreetService } from '../types/breet.types.js';

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createBreetService(): BreetService {
  if (env.BREET_MOCK) {
    logger.info('Breet service: MOCK');
    return new MockBreetService();
  }
  if (!env.BREET_API_KEY) {
    logger.fatal('BREET_MOCK=false but BREET_API_KEY is not set. Refusing to start.');
    process.exit(1);
  }
  logger.info('Breet service: REAL');
  return new RealBreetService(env.BREET_API_BASE_URL, env.BREET_API_KEY);
}

// ─── Mock ─────────────────────────────────────────────────────────────────────

class MockBreetService implements BreetService {
  async getLimits() {
    await Promise.resolve();
    return { minAmount: 10, maxAmount: 10000 };
  }

  async getRate() {
    await Promise.resolve();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    return { rate: 1520, expiresAt };
  }

  async getBanks() {
    await Promise.resolve();
    return [
      { code: '044', name: 'Access Bank' },
      { code: '058', name: 'Guaranty Trust Bank' },
      { code: '033', name: 'United Bank for Africa' },
      { code: '011', name: 'First Bank of Nigeria' },
      { code: '057', name: 'Zenith Bank' },
    ];
  }

  async resolveAccount(_bankCode: string, _accountNumber: string) {
    await sleep(800); // simulate real latency
    return { accountName: 'JOHN DOE' };
  }

  async initiateOfframp(params: {
    amount: number;
    bankCode: string;
    accountNumber: string;
    idempotencyKey: string;
  }) {
    await sleep(300);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    return {
      transactionId: `mock_tx_${Date.now()}`,
      depositAddress: `TRC20_MOCK_${params.idempotencyKey.slice(0, 8).toUpperCase()}`,
      expiresAt,
    };
  }

  async getTransaction(breetTransactionId: string) {
    await Promise.resolve();
    return { status: 'PROCESSING', transactionId: breetTransactionId };
  }
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RESET_MS = 60_000;

type CircuitState = 'CLOSED' | 'OPEN';

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private openedAt: number | null = null;

  isOpen(): boolean {
    if (this.state === 'OPEN') {
      if (this.openedAt !== null && Date.now() - this.openedAt >= CIRCUIT_RESET_MS) {
        logger.info('Circuit breaker: resetting to CLOSED after cooldown');
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.openedAt = null;
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failureCount = 0;
  }

  recordFailure(): void {
    this.failureCount++;
    if (this.failureCount >= CIRCUIT_FAILURE_THRESHOLD) {
      this.state = 'OPEN';
      this.openedAt = Date.now();
      logger.error(
        { failureCount: this.failureCount },
        'Circuit breaker: OPEN — Breet API paused for 60s',
      );
    }
  }
}

// ─── Real ─────────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

class RealBreetService implements BreetService {
  private readonly circuit = new CircuitBreaker();

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async getLimits(): Promise<{ minAmount: number; maxAmount: number }> {
    return this.request<{ minAmount: number; maxAmount: number }>('GET', '/v1/limits');
  }

  async getRate(): Promise<{ rate: number; expiresAt: string }> {
    return this.request<{ rate: number; expiresAt: string }>('GET', '/v1/rates/usdt-ngn');
  }

  async getBanks(): Promise<Array<{ code: string; name: string }>> {
    return this.request<Array<{ code: string; name: string }>>('GET', '/v1/banks');
  }

  async resolveAccount(
    bankCode: string,
    accountNumber: string,
  ): Promise<{ accountName: string }> {
    return this.request<{ accountName: string }>('GET', '/v1/accounts/resolve', {
      bankCode,
      accountNumber,
    });
  }

  async initiateOfframp(params: {
    amount: number;
    bankCode: string;
    accountNumber: string;
    idempotencyKey: string;
  }): Promise<{ transactionId: string; depositAddress: string; expiresAt: string }> {
    return this.request<{ transactionId: string; depositAddress: string; expiresAt: string }>(
      'POST',
      '/v1/offramp',
      params,
    );
  }

  async getTransaction(breetTransactionId: string): Promise<{
    status: string;
    [key: string]: unknown;
  }> {
    return this.request<{ status: string; [key: string]: unknown }>(
      'GET',
      `/v1/transactions/${breetTransactionId}`,
    );
  }

  // ─── Core request with retry + circuit breaker ─────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    if (this.circuit.isOpen()) {
      throw AppError.internal(
        ErrorCode.BREET_CIRCUIT_OPEN,
        'Breet API temporarily unavailable. Please try again shortly.',
      );
    }

    let url = `${this.baseUrl}${path}`;
    let lastError: Error | null = null;

    // GET params become query string — skip null/undefined values
    if (method === 'GET' && params) {
      const qs = new URLSearchParams(
        Object.fromEntries(
          Object.entries(params)
            .filter(([, v]) => v !== null && v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ),
      ).toString();
      if (qs) url = `${url}?${qs}`;
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const fetchInit: RequestInit = {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            'X-Request-ID': crypto.randomUUID(),
          },
          signal: AbortSignal.timeout(15_000),
        };
        if (method === 'POST') {
          fetchInit.body = JSON.stringify(params);
        }
        const response = await fetch(url, fetchInit);

        // 4xx — do not retry, do NOT count toward circuit breaker (client error, not server fault)
        if (response.status >= 400 && response.status < 500) {
          const text = await response.text();
          throw AppError.badRequest(
            ErrorCode.BREET_API_ERROR,
            `Breet API ${response.status}: ${text}`,
          );
        }

        // 5xx — will retry
        if (!response.ok) {
          throw new Error(`Breet API server error ${response.status}`);
        }

        const data = (await response.json()) as T;
        this.circuit.recordSuccess();
        return data;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // AppErrors (4xx) — never retry
        if (err instanceof AppError && err.statusCode < 500) {
          throw err;
        }

        const isLastAttempt = attempt === MAX_RETRIES;
        if (isLastAttempt) {
          this.circuit.recordFailure();
          logger.error({ err, attempt, path }, 'Breet API failed after all retries');
          break;
        }

        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        logger.warn({ attempt, backoff, path, err: lastError.message }, 'Breet API error, retrying...');
        await sleep(backoff);
      }
    }

    throw AppError.internal(
      ErrorCode.BREET_API_ERROR,
      `Breet API call failed after ${MAX_RETRIES} attempts: ${lastError?.message ?? 'unknown'}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
