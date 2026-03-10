/**
 * Rate service — Sprint 2.1 / 3.1
 *
 * Wraps BreetService.getRate() and applies the configurable SPREAD_PERCENT
 * to produce the user-facing rate. The raw Breet rate is stored separately
 * in the transaction for accounting purposes.
 *
 * The user always sees displayRate (includes our margin).
 * The DB stores both rawRate and serviceMargin for P&L tracking.
 */
import { env } from '../config/env.js';
import type { BreetService } from '../types/breet.types.js';

export type Quote = {
  rawRate: number;        // rate from Breet (cost price)
  displayRate: number;    // rate shown to user (rawRate + our spread)
  margin: number;         // our profit per USDT (displayRate - rawRate)
  fiatAmount: number;     // NGN the user will receive for quoteAmount USDT
  serviceMarginTotal: number; // total margin captured (margin * quoteAmount)
  expiresAt: string;      // ISO string from Breet
};

export class RateService {
  constructor(private readonly breet: BreetService) { }

  async getQuote(usdtAmount: number): Promise<Quote> {
    const { rate: rawRate, expiresAt } = await this.breet.getRate();

    const spreadFactor = 1 + env.SPREAD_PERCENT / 100;
    const displayRate = parseFloat((rawRate * spreadFactor).toFixed(2));
    const margin = parseFloat((displayRate - rawRate).toFixed(2));
    const fiatAmount = parseFloat((usdtAmount * displayRate).toFixed(2));
    const serviceMarginTotal = parseFloat((usdtAmount * margin).toFixed(2));

    return {
      rawRate,
      displayRate,
      margin,
      fiatAmount,
      serviceMarginTotal,
      expiresAt,
    };
  }

  /**
   * Check if a stored quote is still valid.
   * Returns true if the quote has expired.
   */
  static isExpired(quoteExpiresAt: string): boolean {
    return new Date(quoteExpiresAt) <= new Date();
  }

  /**
   * Format a number as NGN with thousands separator.
   * e.g. 152000 → "152,000"
   */
  static formatNGN(amount: number): string {
    return amount.toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /**
   * Minutes remaining until quote expires.
   */
  static minutesRemaining(expiresAt: string): number {
    const ms = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.floor(ms / 60_000));
  }
}
