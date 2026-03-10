export type SessionStep =
  | 'IDLE'
  | 'AWAITING_AMOUNT'
  | 'AWAITING_BANK'
  | 'AWAITING_ACCOUNT'
  | 'AWAITING_CONFIRMATION'
  | 'AWAITING_DEPOSIT'
  | 'SUPPORT'
  | 'COMPLETE'
  | 'ERROR';

export type UserSession = {
  userId: string;
  channel: 'whatsapp' | 'telegram';
  step: SessionStep;
  transactionId?: string;
  quoteAmount?: number;
  quotedRate?: number;         // rate shown to user (includes spread)
  rawBreetRate?: number;       // rate from Breet before spread
  serviceMargin?: number;      // margin captured on this quote
  quoteExpiresAt?: string;
  selectedBank?: { code: string; name: string };
  accountNumber?: string;
  accountName?: string;
  depositAddress?: string;
  retryCount?: number;         // track account resolution retries
  lastMessageAt?: string;      // ISO string — for session timeout logic
};

export type BotResponse = {
  text: string;
  keyboard?: InlineKeyboard | ReplyKeyboard;
  parseMode?: 'Markdown' | 'HTML';
};

export type InlineKeyboard = {
  type: 'inline';
  buttons: Array<Array<{ text: string; callbackData: string }>>;
};

export type ReplyKeyboard = {
  type: 'reply';
  buttons: Array<Array<string>>;
  oneTime?: boolean;
};
