/**
 * PayoutTransaction Model
 * 
 * Immutable audit ledger. Every balance-affecting event creates a transaction record.
 * This is the system's source of truth — if the materialized balance ever drifts,
 * it can be recomputed from the transaction log.
 * 
 * Transaction Types:
 * ──────────────────
 * advance                — 10% advance payout credited for a pending sale
 * reconciliation_credit  — Remaining amount credited for an approved sale
 * reconciliation_debit   — Advance clawed back for a rejected sale
 * withdrawal             — User-initiated withdrawal (debit)
 * withdrawal_reversal    — Failed/cancelled payout credited back
 */

const { getDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class PayoutTransaction {
  /**
   * Record a new transaction.
   */
  static create({ userId, type, amount, referenceId = null, description = '' }) {
    const db = getDatabase();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO payout_transactions (id, user_id, type, amount, reference_id, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, type, amount, referenceId, description);
    return this.findById(id);
  }

  /**
   * Find a transaction by ID.
   */
  static findById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM payout_transactions WHERE id = ?').get(id);
  }

  /**
   * Get all transactions for a user (paginated).
   */
  static findByUserId(userId, { limit = 50, offset = 0 } = {}) {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM payout_transactions 
      WHERE user_id = ? 
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, limit, offset);
  }

  /**
   * Get transactions by reference (e.g., all transactions for a specific sale).
   */
  static findByReferenceId(referenceId) {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM payout_transactions WHERE reference_id = ?
      ORDER BY created_at ASC
    `).all(referenceId);
  }

  /**
   * Recompute user balance from transaction log (for verification/repair).
   */
  static computeBalanceFromLog(userId) {
    const db = getDatabase();
    const result = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN type IN ('advance', 'reconciliation_credit', 'withdrawal_reversal') THEN amount ELSE 0 END), 0) as total_credits,
        COALESCE(SUM(CASE WHEN type IN ('reconciliation_debit', 'withdrawal') THEN amount ELSE 0 END), 0) as total_debits
      FROM payout_transactions 
      WHERE user_id = ?
    `).get(userId);
    
    return {
      computed_balance: result.total_credits - result.total_debits,
      total_credits: result.total_credits,
      total_debits: result.total_debits
    };
  }
}

module.exports = PayoutTransaction;
