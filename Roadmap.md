# Illusion Services — Build Plan
**Stack:** Node.js + TypeScript + Fastify + PostgreSQL + Redis + Grammy.js + Twilio
**Tools:** Gemini (architecture/heavy lifting) + Claude CLI (implementation/boilerplate)
**Methodology:** Phase → Sprint → Task

---

## Pre-Build Checklist (Before Writing Any Code)

Before sprint 1 starts, confirm these are in hand:

- [ ] Breet B2B API docs — exact endpoint names, webhook payload shapes, signature header name
- [ ] Telegram bot token from @BotFather
- [ ] Supabase project created (free tier)
- [ ] **Verify Supabase PITR (Point in Time Recovery)** is enabled for disaster recovery
- [ ] Upstash Redis instance created (free tier)
- [ ] Railway project created
- [ ] `.env.example` file drafted with every key you'll eventually need

---

## Phase 1 — Foundation
*Goal: Runnable server, database, Redis, and project structure. Nothing works end-to-end yet but everything is wired.*

### Sprint 1.1 — Project Scaffold (Day 1)
**Assign to: Claude CLI**

- [ ] Init TypeScript + Fastify project with strict TS config
- [ ] Folder structure:
```
src/
  bot/
    telegram/
    whatsapp/
  webhooks/
    meta.ts
    telegram.ts
    breet.ts
  services/
    breet.service.ts       ← mock first
    session.service.ts
    notification.service.ts
  db/
    schema.sql
    migrations/
  middleware/
    signature.verify.ts
  utils/
    logger.ts
    errors.ts
  config/
    env.ts                 ← zod-validated env vars
  types/
    session.types.ts
    breet.types.ts
```
- [ ] Zod env validation on startup — app crashes immediately if any required env var is missing. No silent failures.
- [ ] Structured JSON logger (Pino) — every log has `requestId`, `userId`, `step`
- [ ] Global error handler on Fastify — never expose stack traces to the outside
- [ ] Health check endpoint `GET /health` returns `{ status: "ok", ts: <timestamp> }`

---

### Sprint 1.2 — Database (Day 1–2)
**Assign to: Claude CLI**

Full schema with everything from the plan plus additions a senior engineer would add:

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_number VARCHAR(20) UNIQUE,
  telegram_id VARCHAR(20) UNIQUE,
  preferred_channel VARCHAR(10) CHECK (preferred_channel IN ('whatsapp', 'telegram')),
  is_blocked BOOLEAN DEFAULT false,     -- fraud/abuse flag
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT at_least_one_channel CHECK (
    whatsapp_number IS NOT NULL OR telegram_id IS NOT NULL
  )
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  breet_transaction_id TEXT UNIQUE,
  asset_ticker VARCHAR(10) DEFAULT 'USDT',
  asset_network VARCHAR(10) DEFAULT 'TRC20',
  asset_amount DECIMAL(18,6) NOT NULL,
  fiat_amount DECIMAL(18,2) NOT NULL,
  locked_rate DECIMAL(18,2) NOT NULL,
  service_margin DECIMAL(18,2) NOT NULL DEFAULT 0, -- Our profit/spread per trade
  rate_locked_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  deposit_address TEXT UNIQUE,
  payout_bank_code VARCHAR(10),
  payout_account VARCHAR(20),
  payout_account_name TEXT,
  idempotency_key UUID UNIQUE DEFAULT gen_random_uuid(),
  status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','AWAITING_DEPOSIT','CONFIRMING',
    'PROCESSING','COMPLETED','FAILED','EXPIRED'
  )),
  failure_reason TEXT,
  settled_rate DECIMAL(18,2),           -- actual rate used if expired
  settled_fiat_amount DECIMAL(18,2),    -- recalculated if rate expired
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id),
  user_id UUID REFERENCES users(id),
  event VARCHAR(50) NOT NULL,           -- e.g. RATE_LOCKED, DEPOSIT_RECEIVED
  actor VARCHAR(20) NOT NULL,           -- 'user', 'bot', 'breet', 'system'
  payload JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_deposit_address ON transactions(deposit_address);
CREATE INDEX idx_audit_log_transaction_id ON audit_log(transaction_id);
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
```

- [ ] Write migration runner (simple — no ORM, raw SQL via `pg`)
- [ ] Write `db.ts` pool client with connection timeout and max pool size set explicitly
- [ ] Seed script with 2 test users and 3 mock transactions for local dev

---

### Sprint 1.3 — Redis Session Service (Day 2)
**Assign to: Claude CLI**

```typescript
// Full UserSession type
type UserSession = {
  userId: string;
  channel: 'whatsapp' | 'telegram';
  step:
    | 'IDLE'
    | 'AWAITING_AMOUNT'
    | 'AWAITING_BANK'
    | 'AWAITING_ACCOUNT'
    | 'AWAITING_CONFIRMATION'
    | 'AWAITING_DEPOSIT'
    | 'COMPLETE'
    | 'ERROR';
  transactionId?: string;
  quoteAmount?: number;
  quotedRate?: number;
  quoteExpiresAt?: string;
  selectedBank?: { code: string; name: string };
  accountNumber?: string;
  accountName?: string;
  depositAddress?: string;
  retryCount?: number;           // track how many times user has retried
  lastMessageAt?: string;        // for session timeout logic
};
```

- [ ] `getSession(userId)` — returns session or creates fresh IDLE session
- [ ] `setSession(userId, session)` — saves with TTL of 30 minutes
- [ ] `clearSession(userId)` — on COMPLETE or ERROR
- [ ] `extendSession(userId)` — resets TTL on every user interaction
- [ ] Sessions expire automatically after 30 min of inactivity — Redis TTL handles this
- [ ] Unit tests for all four methods with a Redis mock

---

### Sprint 1.4 — Deployment & CI Pipeline (Day 2-3)
**Assign to: Claude CLI**

- [ ] Write a multi-stage `Dockerfile` to keep the image small and ensure consistency across local, staging, and Railway
- [ ] Set up GitHub Actions CI (run TS type-checking, linting, and unit tests on every PR)
- [ ] Set up a Staging Environment on Railway attached to a staging Supabase instance for end-to-end sandbox testing

---

## Phase 2 — Mock Breet Layer
*Goal: Full transaction flow works end-to-end against a mock. You can demo the entire product before Breet keys arrive.*

### Sprint 2.1 — Breet Service Interface (Day 3)
**Assign to: Gemini**

Define the full TypeScript interface first, then implement mock:

```typescript
interface BreetService {
  getLimits(): Promise<{ minAmount: number; maxAmount: number }>;
  getRate(): Promise<{ rate: number; expiresAt: string }>;
  getBanks(): Promise<Array<{ code: string; name: string }>>;
  resolveAccount(bankCode: string, accountNumber: string): 
    Promise<{ accountName: string }>;
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
  getTransaction(breetTransactionId: string): 
    Promise<{ status: string; [key: string]: any }>;
}
```

- [ ] `MockBreetService` — implements the interface with realistic fake data
- [ ] Mock `getLimits()` returns $10 min, $10,000 max
- [ ] Mock `getRate()` returns ₦1,520 with 10-min expiry
- [ ] Mock `getBanks()` returns 5 real Nigerian banks
- [ ] Mock `resolveAccount()` returns a fake name after 800ms delay (simulate real latency)
- [ ] Mock `initiateOfframp()` returns a fake TRC20 address
- [ ] `RealBreetService` — same interface, hits actual Breet API (stubbed until keys arrive)
- [ ] Factory pattern: `config.BREET_MOCK === 'true'` returns Mock, else Real
- [ ] `RateService` — Wraps `BreetService` and applies a configurable markup (`SPREAD_PERCENT` env var, e.g., 1.5%) to the raw Breet rate ensuring profitability
- [ ] This means **zero code changes** when you switch from mock to real

---

### Sprint 2.2 — Mock Webhook Simulator (Day 3–4)
**Assign to: Claude CLI**

You need to be able to trigger fake Breet webhook events during development:

- [ ] `POST /dev/simulate/deposit` — fires a fake `DEPOSIT_CONFIRMED` event to your own webhook handler
- [ ] `POST /dev/simulate/payout` — fires a fake `PAYOUT_COMPLETED` event
- [ ] Both endpoints are **disabled in production** via env check `NODE_ENV !== 'production'`
- [ ] Simulation includes correct HMAC signature so your verification middleware passes
- [ ] Document exactly how to use these in `README.md`

---

## Phase 3 — Core Conversation Engine
*Goal: The state machine that drives every conversation. This is your most important code.*

### Sprint 3.1 — State Machine (Day 4–5)
**Assign to: Gemini**

This is the brain. Gemini handles the architecture:

```typescript
// Every channel calls this single function
async function handleMessage(params: {
  userId: string;
  channel: 'whatsapp' | 'telegram';
  text: string;
  // for Telegram inline keyboard callbacks:
  callbackData?: string;
}): Promise<BotResponse> {
  const session = await sessionService.getSession(userId);
  
  switch (session.step) {
    case 'IDLE':             return handleIdle(params, session);
    case 'AWAITING_AMOUNT':  return handleAmount(params, session);
    case 'AWAITING_BANK':    return handleBank(params, session);
    case 'AWAITING_ACCOUNT': return handleAccount(params, session);
    case 'AWAITING_CONFIRMATION': return handleConfirmation(params, session);
    case 'AWAITING_DEPOSIT': return handleDepositReminder(params, session);
    case 'SUPPORT':          return handleSupport(params, session);
    default:                 return handleUnknown(params, session);
  }
}
```

Each handler must:
- [ ] Validate input — wrong input returns helpful error, stays on same step
- [ ] Write to audit log on every state transition
- [ ] Never throw — catch internally and return an error response
- [ ] Return a typed `BotResponse` object, not raw strings
- [ ] **Copy Abstraction:** Move all user-facing copy to a localized `src/copy/messages.ts` (no hardcoding strings inside handlers)

Edge cases Gemini must handle:
- [ ] User sends "cancel" at any step — clears session, confirms cancellation
- [ ] User sends "status" at any step — returns current transaction status
- [ ] User sends "help" or "support" — flags transaction for manual intervention and routes them to a `SUPPORT` state, providing human handoff contact info
- [ ] User starts a new "sell" while `AWAITING_DEPOSIT` — warn them they have a pending transaction
- [ ] Amount below minimum or above maximum (checked against `getLimits()`) — reject with specific message
- [ ] Account resolution fails — retry prompt, max 3 attempts then drop to error state
- [ ] Rate expires mid-flow (between `AWAITING_CONFIRMATION` and address generation) — re-quote and ask user to reconfirm

---

### Sprint 3.2 — Breet Webhook Handler (Day 5–6)
**Assign to: Gemini**

This is your most security-critical code:

```typescript
// POST /webhook/breet
async function handleBreetWebhook(request, reply) {
  // Step 1: Return 200 IMMEDIATELY before any processing
  reply.code(200).send({ received: true });
  
  // Step 2: Verify signature HMAC-SHA256
  // Step 3: Check idempotency — have we processed this event before?
  // Step 4: Load transaction by deposit_address or breet_transaction_id
  // Step 5: Validate state transition is legal
  // Step 6: Update transaction status in DB (atomic)
  // Step 7: Write audit log
  // Step 8: Notify user via their channel
  // Step 9: If rate expired → recalculate → notify user of adjustment
}
```

- [ ] Idempotency table — store processed webhook event IDs, reject duplicates silently
- [ ] State transition guard — `COMPLETED → PROCESSING` is illegal, log and drop
- [ ] All DB updates in a single transaction — no partial state
- [ ] **Notification Queue:** Push user notifications to a BullMQ/Redis queue allowing for retries instead of direct sending, to ensure "Payment Received" alerts are never lost if external APIs fail
- [ ] If user notification fails (after queue retries) — log it, do NOT retry the webhook processing
- [ ] Dead letter handling — webhook events that fail processing go to a `failed_webhooks` table for manual review

---

## Phase 4 — Channel Integrations
*Goal: Real bots on real channels, using the state machine from Phase 3.*

### Sprint 4.1 — Telegram Bot (Day 6–7)
**Assign to: Claude CLI**

- [ ] Grammy.js setup with webhook mode (not polling — polling is for development only)
- [ ] All text messages route to `handleMessage()`
- [ ] Inline keyboard for bank selection — buttons not free text
- [ ] Inline keyboard for yes/no confirmation
- [ ] Copyable deposit address (Telegram supports monospace code blocks)
- [ ] Typing indicator (`sendChatAction`) while bot is processing
- [ ] `/start` command — welcome message + explain the service
- [ ] `/cancel` command — cancels active transaction
- [ ] `/status` command — shows current transaction state
- [ ] `/help` command — lists available commands
- [ ] Error messages are friendly — never expose internal errors to user

---

### Sprint 4.2 — WhatsApp Bot Scaffolding (Day 8–9)
**Assign to: Claude CLI / Gemini** *(Scaffold before Twilio keys arrive)*

- [ ] Twilio webhook receives messages, routes to same `handleMessage()`
- [ ] WhatsApp interactive list messages for bank selection
- [ ] WhatsApp quick reply buttons for yes/no
- [ ] Message templates pre-approved for deposit confirmation and payout notification
- [ ] Twilio signature verification middleware
- [ ] Handle WhatsApp-specific message types gracefully — audio, image, etc. → "Please reply with text only"
- [ ] Note: Telegram bot should be 100% complete before touching this sprint

---

## Phase 5 — Security Hardening
*Goal: Production-grade security before a single real user touches it.*

### Sprint 5.1 — Security Layer (Day 9–10)
**Assign to: Gemini**

- [ ] **Rate limiting & Volumes** — per userId: max 5 messages/minute, max 3 transactions/day. Add rolling 24hr fiat volume limit (e.g., max ₦500k/day) to manage liquidity/regulatory risks.
- [ ] **Webhook signature verification** — HMAC-SHA256 for both Breet and Twilio. Middleware rejects before handler runs.
- [ ] **Input sanitization** — strip all non-numeric from amount fields, strip non-numeric from account numbers. Zod schemas on every handler input.
- [ ] **Blocked user check** — `is_blocked` flag checked on every message before processing
- [ ] **Minimum/maximum transaction limits** — configurable via env vars, not hardcoded
- [ ] **Deposit address uniqueness** — enforce at DB level, never reuse addresses
- [ ] **Env var audit** — no secrets in logs, ever. Pino redact config for all secret fields.
- [ ] **SQL injection** — parameterized queries only, no string concatenation
- [ ] **No internal errors to users** — all errors map to user-friendly messages via error code map
- [ ] **Database Archiving Strategy** — Add a cron job to move `audit_log` entries > 90 days to a cold storage/archive table to prevent DB bloat.

---

### Sprint 5.2 — Resilience (Day 10–11)
**Assign to: Gemini**

- [ ] **Retry logic** — Breet API calls retry up to 3 times with exponential backoff on 5xx errors. Never retry on 4xx.
- [ ] **Circuit breaker** — if Breet API fails 5 consecutive times, stop sending requests for 60 seconds and notify user gracefully
- [ ] **Transaction expiry cron** — every 5 minutes, query for `AWAITING_DEPOSIT` transactions past `expires_at`, mark as `EXPIRED`, notify user
- [ ] **Redis failure fallback** — if Redis is down, fall back to in-memory session store (single instance only, acceptable for recovery period)
- [ ] **DB connection retry** — on startup, retry DB connection up to 5 times before crashing
- [ ] **Graceful shutdown** — on SIGTERM, finish in-flight requests before closing

---

## Phase 6 — Observability + Launch
*Goal: You can see everything happening in production in real time.*

### Sprint 6.1 — Observability (Day 11–12)
**Assign to: Claude CLI**

- [ ] Pino structured logging — every log line has `{ level, ts, requestId, userId, step, event }`
- [ ] Railway log drain — logs stream to Railway dashboard
- [ ] **Automated Error Tracking:** Integrate Sentry (free tier) to seamlessly capture unhandled promise rejections, stack traces, and local context automatically
- [ ] Key metrics to log explicitly:
  - Transaction initiated
  - Rate locked
  - Address generated
  - Deposit confirmed
  - Payout completed
  - Transaction expired
  - Webhook rejected (bad signature)
  - Rate recalculated (expiry case)
- [ ] `GET /health` enhanced — checks DB connection, Redis connection, and returns `degraded` if either is down
- [ ] Error alerting — critical errors (bad webhook signatures, double-spend attempts) send a Telegram message to your own personal chat

---

### Sprint 6.2 — Pre-Launch QA (Day 12–14)
**Assign to: Both**

Run every one of these manually before any real user:

- [ ] Happy path — full sell flow from "Sell" to "₦ sent" using mock
- [ ] Cancel mid-flow at every step — session clears correctly
- [ ] Send gibberish at every step — bot handles gracefully, doesn't crash
- [ ] Expired rate — deposit arrives after expiry, recalculation fires correctly
- [ ] Duplicate webhook — same event fires twice, second is silently ignored
- [ ] Fake webhook (bad signature) — rejected with 401, logged
- [ ] Blocked user — sends message, gets blocked response, nothing processes
- [ ] Concurrent sessions — two different users transacting simultaneously, no session bleed
- [ ] Redis goes down mid-transaction — graceful degradation
- [ ] Switch `BREET_MOCK=false` — real API keys, run one real transaction end to end

---

### Sprint 6.3 — Automated E2E Integration Tests (Day 15)
**Assign to: Gemini**

- [ ] Write automated End-to-End integration tests for the state machine
- [ ] Cover the "happy path", "expired rate path", and "timeout path" using `MockBreetService`
- [ ] Ensures no regressions occur during future updates to the conversation engine

---

## Key Engineering Principles Across All Phases

**Never trust user input.** Every field validated with Zod before it touches any service.

**Audit everything.** Every state change writes to `audit_log`. If you can't reconstruct exactly what happened in a transaction from the audit log alone, the logging is insufficient.

**Async all webhooks.** 200 OK fires before any processing begins. Always.

**One interface, two implementations.** Mock and Real Breet services are interchangeable. `NODE_ENV` and `BREET_MOCK` env vars control which runs.

**Crash loudly on startup, never in production.** Missing env vars, bad DB connection — crash on boot. Once running, handle all errors gracefully.

**Secrets never touch logs.** Pino redact list includes every key, token, account number, and address.

---

## Phase 7 — Admin & Back Office
*Goal: Manage the business, track profitability, and resolve stuck transactions manually.*

### Sprint 7.1 — Admin Telegram Commands (Day 16)
**Assign to: Claude CLI**

- [ ] Telegram commands restricted securely by your personal `telegram_id`
- [ ] `/admin volume` — check today's trade volume and total profit margin
- [ ] `/admin tx <id>` — view full transaction state and audit log
- [ ] `/admin block <userId>` — manually flag `is_blocked = true` for a malicious user
- [ ] `/admin failed` — list the last 10 failed webhooks from `failed_webhooks` table
- [ ] `/admin health` — quick check on DB, Redis, and Breet API statuses

### Sprint 7.2 — Admin Web Dashboard (Post-Launch)
**Assign to: Gemini / Claude CLI**

- [ ] Complete Next.js (App Router) dashboard with Tailwind CSS and a JWT-protected Fastify API
- [ ] Overview page: 4 KPI cards (Total Volume, Daily Profit Margin, Active Sessions, Blocked Users) powered by Lucide React icons
- [ ] Display daily P&L charts (via Recharts), searchable transaction lists with filters, and user management capabilities
- [ ] Visualize data from `audit_log` and the `transactions.fee_amount/service_margin` column

---

## Division of Labour Summary

| Phase | Sprint | Owner |
|---|---|---|
| 1 | Project scaffold + folder structure | Claude |
| 1 | Database schema + migrations | Claude |
| 1 | Redis session service | Claude |
| 1 | Dockerfile + CI Pipeline | Claude |
| 2 | Breet service interface + mock + RateService | Gemini |
| 2 | Mock webhook simulator | Claude |
| 3 | State machine + Copy abstraction | Gemini |
| 3 | Breet webhook handler + Notification Queue | Gemini |
| 4 | Telegram bot | Claude |
| 4 | WhatsApp bot | Claude |
| 5 | Security layer + volume limits + log archiving | Gemini |
| 5 | Resilience + retry + circuit breaker | Gemini |
| 6 | Logging + observability + Sentry | Claude |
| 6 | QA checklist execution | Both |
| 6 | Automated E2E integration tests | Gemini |
| 7 | Admin Telegram commands | Claude |
| 7 | Admin Web Dashboard | Claude |

---

When you're ready to start, say **"begin Phase 1 Sprint 1.1"** and I'll generate the full scaffold code.