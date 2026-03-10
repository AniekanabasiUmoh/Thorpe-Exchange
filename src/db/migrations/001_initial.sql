-- =============================================================================
-- Illusion Services — Database Schema
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- USERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_number   VARCHAR(20) UNIQUE,
  telegram_id       VARCHAR(20) UNIQUE,
  preferred_channel VARCHAR(10) CHECK (preferred_channel IN ('whatsapp', 'telegram')),
  is_blocked        BOOLEAN     NOT NULL DEFAULT false,
  block_reason      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT at_least_one_channel CHECK (
    whatsapp_number IS NOT NULL OR telegram_id IS NOT NULL
  )
);

-- =============================================================================
-- TRANSACTIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS transactions (
  id                    UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID           NOT NULL REFERENCES users(id),
  breet_transaction_id  TEXT           UNIQUE,
  asset_ticker          VARCHAR(10)    NOT NULL DEFAULT 'USDT',
  asset_network         VARCHAR(10)    NOT NULL DEFAULT 'TRC20',
  asset_amount          DECIMAL(18,6)  NOT NULL,
  fiat_amount           DECIMAL(18,2)  NOT NULL,
  locked_rate           DECIMAL(18,2)  NOT NULL,   -- rate shown to user (includes spread)
  raw_breet_rate        DECIMAL(18,2)  NOT NULL,   -- rate from Breet before spread
  service_margin        DECIMAL(18,2)  NOT NULL DEFAULT 0, -- our profit on this trade
  rate_locked_at        TIMESTAMPTZ    NOT NULL,
  expires_at            TIMESTAMPTZ    NOT NULL,
  deposit_address       TEXT           UNIQUE,
  payout_bank_code      VARCHAR(10),
  payout_account        VARCHAR(20),
  payout_account_name   TEXT,
  idempotency_key       UUID           NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status                VARCHAR(20)    NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING',
    'AWAITING_DEPOSIT',
    'CONFIRMING',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'EXPIRED'
  )),
  failure_reason        TEXT,
  settled_rate          DECIMAL(18,2),              -- actual rate used if original expired
  settled_fiat_amount   DECIMAL(18,2),              -- recalculated if rate expired
  created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- AUDIT LOG
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID        REFERENCES transactions(id),
  user_id         UUID        REFERENCES users(id),
  event           VARCHAR(50) NOT NULL,   -- e.g. RATE_LOCKED, DEPOSIT_RECEIVED
  actor           VARCHAR(20) NOT NULL,   -- 'user', 'bot', 'breet', 'system'
  payload         JSONB,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- WEBHOOK IDEMPOTENCY — prevent duplicate webhook processing
-- =============================================================================
CREATE TABLE IF NOT EXISTS processed_webhooks (
  event_id    TEXT        PRIMARY KEY,   -- Breet's unique event ID
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- FAILED WEBHOOKS — dead letter queue for manual review
-- =============================================================================
CREATE TABLE IF NOT EXISTS failed_webhooks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    TEXT,
  payload     JSONB       NOT NULL,
  error       TEXT        NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed    BOOLEAN     NOT NULL DEFAULT false
);

-- =============================================================================
-- AUDIT LOG ARCHIVE — cold storage for entries > 90 days
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_log_archive (
  LIKE audit_log INCLUDING ALL
);

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_transactions_user_id        ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status         ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_deposit_address ON transactions(deposit_address);
CREATE INDEX IF NOT EXISTS idx_transactions_expires_at     ON transactions(expires_at) WHERE status = 'AWAITING_DEPOSIT';
CREATE INDEX IF NOT EXISTS idx_audit_log_transaction_id    ON audit_log(transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id           ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at        ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_failed_webhooks_reviewed    ON failed_webhooks(reviewed) WHERE reviewed = false;

-- =============================================================================
-- UPDATED_AT trigger
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
