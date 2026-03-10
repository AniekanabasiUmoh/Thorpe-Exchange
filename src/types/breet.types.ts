export interface BreetService {
  getLimits(): Promise<{ minAmount: number; maxAmount: number }>;
  getRate(): Promise<{ rate: number; expiresAt: string }>;
  getBanks(): Promise<Array<{ code: string; name: string }>>;
  resolveAccount(
    bankCode: string,
    accountNumber: string,
  ): Promise<{ accountName: string }>;
  initiateOfframp(params: {
    amount: number;
    bankCode: string;
    accountNumber: string;
    idempotencyKey: string;
  }): Promise<{
    transactionId: string;
    depositAddress: string;
    expiresAt: string;
  }>;
  getTransaction(breetTransactionId: string): Promise<{
    status: string;
    [key: string]: unknown;
  }>;
}

export type BreetWebhookEvent =
  | 'DEPOSIT_CONFIRMED'
  | 'PAYOUT_COMPLETED'
  | 'PAYOUT_FAILED'
  | 'TRANSACTION_EXPIRED';

export type BreetWebhookPayload = {
  eventId: string;
  event: BreetWebhookEvent;
  transactionId: string;
  depositAddress?: string;
  amount?: number;
  timestamp: string;
  [key: string]: unknown;
};
