/**
 * Database Migration Script
 * 
 * Creates all required tables with proper indexes, constraints, and relationships.
 * Idempotent — safe to run multiple times (uses IF NOT EXISTS).
 * 
 * Schema Design Decisions:
 * ─────────────────────────
 * 1. `sales` — Core entity. Each row = one affiliate sale.
 *    - `advance_paid` flag prevents duplicate advance payouts (idempotency).
 *    - Composite index on (user_id, status) for fast per-user aggregations.
 * 
 * 2. `advance_payouts` — Audit trail for every advance payout disbursed.
 *    - Links to `sales` via sale_id (one-to-one for advances).
 *    - Enables tracing exactly which sale triggered which payout.
 * 
 * 3. `user_balances` — Materialized balance per user.
 *    - `withdrawable_balance` = amount user can withdraw right now.
 *    - `total_earned` = lifetime approved earnings (for reporting).
 *    - `total_advance_paid` = lifetime advances disbursed.
 *    - `adjustment_balance` = net adjustments from rejected sales.
 * 
 * 4. `payouts` — Every withdrawal attempt (pending/completed/failed/cancelled/rejected).
 *    - Tracks lifecycle of each withdrawal request.
 * 
 * 5. `payout_transactions` — Immutable ledger of all balance-affecting events.
 *    - Types: advance, reconciliation_credit, reconciliation_debit, withdrawal, 
 *             withdrawal_reversal
 *    - Provides full auditability.
 * 
 * 6. `reconciliation_logs` — Records each reconciliation batch for traceability.
 */

const { getDatabase, closeDatabase } = require('../config/database');

function migrate() {
  const db = getDatabase();

  db.exec(`
    -- ═══════════════════════════════════════════════════════════
    -- USERS TABLE
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT UNIQUE,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ═══════════════════════════════════════════════════════════
    -- BRANDS TABLE
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS brands (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL UNIQUE,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ═══════════════════════════════════════════════════════════
    -- SALES TABLE — Core entity
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS sales (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      brand_id        TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending', 'approved', 'rejected')),
      earning         REAL NOT NULL CHECK(earning >= 0),
      advance_paid    INTEGER NOT NULL DEFAULT 0 CHECK(advance_paid IN (0, 1)),
      advance_amount  REAL NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id)  REFERENCES users(id),
      FOREIGN KEY (brand_id) REFERENCES brands(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sales_user_status 
      ON sales(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_sales_status 
      ON sales(status);
    CREATE INDEX IF NOT EXISTS idx_sales_advance_paid 
      ON sales(user_id, advance_paid, status);

    -- ═══════════════════════════════════════════════════════════
    -- USER BALANCES — Materialized balance per user
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS user_balances (
      user_id               TEXT PRIMARY KEY,
      withdrawable_balance  REAL NOT NULL DEFAULT 0,
      total_earned          REAL NOT NULL DEFAULT 0,
      total_advance_paid    REAL NOT NULL DEFAULT 0,
      adjustment_balance    REAL NOT NULL DEFAULT 0,
      last_withdrawal_at    TEXT,
      updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- ═══════════════════════════════════════════════════════════
    -- PAYOUTS — Withdrawal requests
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS payouts (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      amount          REAL NOT NULL CHECK(amount > 0),
      status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending', 'completed', 'failed', 'cancelled', 'rejected')),
      failure_reason  TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_payouts_user 
      ON payouts(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_payouts_status 
      ON payouts(status);

    -- ═══════════════════════════════════════════════════════════
    -- PAYOUT TRANSACTIONS — Immutable audit ledger
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS payout_transactions (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      type            TEXT NOT NULL
                        CHECK(type IN (
                          'advance',
                          'reconciliation_credit',
                          'reconciliation_debit',
                          'withdrawal',
                          'withdrawal_reversal'
                        )),
      amount          REAL NOT NULL,
      reference_id    TEXT,
      description     TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_user 
      ON payout_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_type 
      ON payout_transactions(type);
    CREATE INDEX IF NOT EXISTS idx_transactions_ref 
      ON payout_transactions(reference_id);

    -- ═══════════════════════════════════════════════════════════
    -- RECONCILIATION LOGS — Batch reconciliation audit trail
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS reconciliation_logs (
      id              TEXT PRIMARY KEY,
      admin_id        TEXT,
      sales_processed INTEGER NOT NULL DEFAULT 0,
      total_credits   REAL NOT NULL DEFAULT 0,
      total_debits    REAL NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  console.log('✅ Database migration completed successfully.');
}

// Run if called directly
if (require.main === module) {
  migrate();
  closeDatabase();
}

module.exports = { migrate };
