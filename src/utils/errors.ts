/**
 * Internal error codes — map to user-friendly messages in copy/messages.ts
 * Never expose these raw codes to end users.
 */
export enum ErrorCode {
  // Input validation
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  AMOUNT_TOO_LOW = 'AMOUNT_TOO_LOW',
  AMOUNT_TOO_HIGH = 'AMOUNT_TOO_HIGH',
  INVALID_ACCOUNT_NUMBER = 'INVALID_ACCOUNT_NUMBER',
  INVALID_BANK = 'INVALID_BANK',

  // Session
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',

  // Transaction
  TRANSACTION_NOT_FOUND = 'TRANSACTION_NOT_FOUND',
  TRANSACTION_EXPIRED = 'TRANSACTION_EXPIRED',
  TRANSACTION_PENDING = 'TRANSACTION_PENDING',
  DUPLICATE_TRANSACTION = 'DUPLICATE_TRANSACTION',
  ILLEGAL_STATE_TRANSITION = 'ILLEGAL_STATE_TRANSITION',

  // Rate
  RATE_EXPIRED = 'RATE_EXPIRED',
  RATE_FETCH_FAILED = 'RATE_FETCH_FAILED',

  // Account resolution
  ACCOUNT_RESOLVE_FAILED = 'ACCOUNT_RESOLVE_FAILED',
  ACCOUNT_RESOLVE_MAX_RETRIES = 'ACCOUNT_RESOLVE_MAX_RETRIES',

  // User
  USER_BLOCKED = 'USER_BLOCKED',
  DAILY_LIMIT_REACHED = 'DAILY_LIMIT_REACHED',
  VOLUME_LIMIT_REACHED = 'VOLUME_LIMIT_REACHED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // Webhook
  INVALID_WEBHOOK_SIGNATURE = 'INVALID_WEBHOOK_SIGNATURE',
  DUPLICATE_WEBHOOK = 'DUPLICATE_WEBHOOK',

  // External services
  BREET_API_ERROR = 'BREET_API_ERROR',
  BREET_CIRCUIT_OPEN = 'BREET_CIRCUIT_OPEN',
  TELEGRAM_SEND_FAILED = 'TELEGRAM_SEND_FAILED',
  WHATSAPP_SEND_FAILED = 'WHATSAPP_SEND_FAILED',

  // DB
  DB_ERROR = 'DB_ERROR',

  // Generic
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode = 500,
    isOperational = true,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // Maintains proper stack trace in V8
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(code: ErrorCode, message: string) {
    return new AppError(code, message, 400);
  }

  static unauthorized(code: ErrorCode, message: string) {
    return new AppError(code, message, 401);
  }

  static forbidden(code: ErrorCode, message: string) {
    return new AppError(code, message, 403);
  }

  static notFound(code: ErrorCode, message: string) {
    return new AppError(code, message, 404);
  }

  static internal(code: ErrorCode, message: string) {
    return new AppError(code, message, 500, false);
  }
}
