/**
 * All user-facing copy lives here — never hardcode strings inside handlers.
 * Sprint 3.1 will fill in the full message set.
 * Keep Nigerian context: Naira symbol ₦, NGN, friendly but professional tone.
 */

export const messages = {
  // Greetings
  welcome: `👋 Welcome to *Illusion Services*!\n\nI help you convert USDT to Nigerian Naira (NGN) quickly and securely.\n\nType *sell* to get started.`,

  help: `Here's what I can do:\n\n• *sell* — Start a new USDT → NGN conversion\n• *status* — Check your active transaction\n• *cancel* — Cancel your current transaction\n• *support* — Get help from our team`,

  // Flow
  askAmount: `How much USDT would you like to sell?\n\nMinimum: {{min}} USDT\nMaximum: {{max}} USDT`,

  quoteReady: `💱 *Current Rate*\n\n{{amount}} USDT = *₦{{naira}}*\nRate: ₦{{rate}} per USDT\n\n_Rate valid for {{minutes}} minutes_\n\nWould you like to proceed?`,

  askBank: `Which bank should we send your ₦{{naira}} to?`,

  askAccount: `Enter your *{{bankName}}* account number:`,

  confirmAccount: `*Account Found ✅*\n\nName: {{accountName}}\nBank: {{bankName}}\nAccount: {{accountNumber}}\n\nIs this correct?`,

  confirmTransaction: `*Confirm Your Transaction*\n\n💰 You send: {{amount}} USDT\n💵 You receive: ₦{{naira}}\n🏦 Bank: {{bankName}} — {{accountNumber}}\n👤 Name: {{accountName}}\n⏱ Rate expires: {{expiry}}\n\nProceed?`,

  depositReady: `*Send Your USDT Here* 👇\n\n\`{{address}}\`\n\nNetwork: TRC20\nAmount: *{{amount}} USDT*\n\n⚠️ Send the *exact* amount. This address expires in {{minutes}} minutes.`,

  depositReceived: `✅ *Deposit Received!*\n\nWe've received your {{amount}} USDT and are processing your payout of *₦{{naira}}*.\n\nYou'll be notified when the transfer is complete.`,

  payoutCompleted: `🎉 *Payment Sent!*\n\n*₦{{naira}}* has been sent to your {{bankName}} account ending in {{lastFour}}.\n\nThank you for using Illusion Services!`,

  // Rate expiry
  rateExpired: `⏰ *Rate Expired*\n\nThe rate has been updated. New quote:\n\n{{amount}} USDT = *₦{{naira}}*\nNew rate: ₦{{rate}} per USDT\n\nWould you like to proceed with the new rate?`,

  // Errors
  invalidAmount: `Please enter a valid amount. Example: *50* or *100.50*`,

  amountTooLow: `Minimum transaction is *{{min}} USDT*. Please enter a higher amount.`,

  amountTooHigh: `Maximum transaction is *{{max}} USDT*. Please enter a lower amount.`,

  invalidAccount: `That doesn't look like a valid account number. Please enter your 10-digit account number.`,

  accountNotFound: `We couldn't verify that account. Please check the number and try again. (Attempt {{attempt}}/3)`,

  accountMaxRetries: `We couldn't verify your account after 3 attempts. Please restart with *sell*.`,

  pendingTransaction: `You already have an active transaction. Please complete or *cancel* it before starting a new one.`,

  cancelled: `Transaction cancelled. Type *sell* to start a new one.`,

  nothingToCancel: `You don't have an active transaction to cancel.`,

  blocked: `Your account has been suspended. Contact support if you believe this is an error.`,

  rateLimitExceeded: `You're sending messages too quickly. Please wait a moment.`,

  dailyLimitReached: `You've reached your daily transaction limit. Please try again tomorrow.`,

  volumeLimitReached: `You've reached your daily volume limit. Please try again tomorrow.`,

  rateExpiredCron: `⏱ *Transaction Expired*\n\nYour transaction for {{amount}} {{ticker}} has expired because we didn't receive your deposit in time.\n\nType *sell* to start a new transaction at the current rate.`,


  transactionExpired: `Your transaction has expired. Please start a new one with *sell*.`,

  genericError: `Something went wrong on our end. Please try again or contact support.`,

  // Status
  statusActive: `*Transaction Status*\n\n📋 ID: \`{{txId}}\`\n📊 Status: {{status}}\n💰 Amount: {{amount}} USDT\n⏱ Expires: {{expiry}}`,

  statusNone: `You don't have an active transaction. Type *sell* to start one.`,

  // Support
  supportEscalated: `A support agent will be with you shortly. You can also reach us at: {{contact}}`,
} as const;

export type MessageKey = keyof typeof messages;

/**
 * Fill template placeholders in a message string.
 * Usage: fillTemplate(messages.quoteReady, { amount: '100', naira: '152,000', rate: '1520', minutes: '10' })
 */
export function fillTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = vars[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}
