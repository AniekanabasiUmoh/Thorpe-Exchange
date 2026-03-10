/**
 * Breet service — Mock + Real implementations.
 * Sprint 2.1 — full implementation by Gemini.
 * Stub: interface + factory only.
 */
import type { BreetService } from '../types/breet.types.js';
import { env } from '../config/env.js';

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createBreetService(): BreetService {
  if (env.BREET_MOCK) {
    return new MockBreetService();
  }
  return new RealBreetService();
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
    // Simulate real API latency
    await sleep(800);
    return { accountName: 'JOHN DOE' };
  }

  async initiateOfframp(params: {
    amount: number;
    bankCode: string;
    accountNumber: string;
    idempotencyKey: string;
  }) {
    await Promise.resolve();
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

// ─── Real ─────────────────────────────────────────────────────────────────────

class RealBreetService implements BreetService {
  // TODO: Sprint 2.1 (Gemini) — implement real Breet API calls with retry + circuit breaker

  async getLimits(): Promise<{ minAmount: number; maxAmount: number }> {
    await Promise.resolve();
    throw new Error('RealBreetService not yet implemented');
  }

  async getRate(): Promise<{ rate: number; expiresAt: string }> {
    await Promise.resolve();
    throw new Error('RealBreetService not yet implemented');
  }

  async getBanks(): Promise<Array<{ code: string; name: string }>> {
    await Promise.resolve();
    throw new Error('RealBreetService not yet implemented');
  }

  async resolveAccount(
    _bankCode: string,
    _accountNumber: string,
  ): Promise<{ accountName: string }> {
    await Promise.resolve();
    throw new Error('RealBreetService not yet implemented');
  }

  async initiateOfframp(_params: {
    amount: number;
    bankCode: string;
    accountNumber: string;
    idempotencyKey: string;
  }): Promise<{ transactionId: string; depositAddress: string; expiresAt: string }> {
    await Promise.resolve();
    throw new Error('RealBreetService not yet implemented');
  }

  async getTransaction(_breetTransactionId: string): Promise<{
    status: string;
    [key: string]: unknown;
  }> {
    await Promise.resolve();
    throw new Error('RealBreetService not yet implemented');
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
