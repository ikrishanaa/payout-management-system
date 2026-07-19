/**
 * UserBalance Model
 * 
 * Manages the materialized balance for each user.
 * 
 * Design Decisions:
 * - We maintain a materialized balance (user_balances table) rather than 
 *   computing it from the transaction log on every read. This is a classic
 *   write-heavy vs read-heavy trade-off:
 *   
 *   ✅ Reads are O(1) — just fetch the row.
 *   ✅ Withdrawable balance is always up-to-date.
 *   ⚠️  Writes must update both the transaction log AND the balance.
 *   
 *   The transaction log (payout_transactions) serves as the source of truth
 *   for audit/debugging. The balance is the "cache" for fast reads.
 * 
 * - `last_withdrawal_at` enforces the 24-hour withdrawal restriction.
 */

const { getDatabase } = require('../config/database');

class UserBalance {
  /**
   * Get or initialize a user's balance record.
   */
  static getByUserId(userId) {
    const db = getDatabase();
    let balance = db.prepare('SELECT * FROM user_balances WHERE user_id = ?').get(userId);
    
    if (!balance) {
      db.prepare(`
        INSERT INTO user_balances (user_id, withdrawable_balance, total_earned, total_advance_paid, adjustment_balance)
        VALUES (?, 0, 0, 0, 0)
      `).run(userId);
      balance = db.prepare('SELECT * FROM user_balances WHERE user_id = ?').get(userId);
    }
    
    return balance;
  }

  /**
   * Credit advance payout to user's withdrawable balance.
   */
  static creditAdvance(userId, amount) {
    const db = getDatabase();
    db.prepare(`
      UPDATE user_balances 
      SET withdrawable_balance = withdrawable_balance + ?,
          total_advance_paid = total_advance_paid + ?,
          updated_at = datetime('now')
      WHERE user_id = ?
    `).run(amount, amount, userId);
    return this.getByUserId(userId);
  }

  /**
   * Credit reconciliation amount (approved sale: earning - advance).
   */
  static creditReconciliation(userId, amount) {
    const db = getDatabase();
    db.prepare(`
      UPDATE user_balances 
      SET withdrawable_balance = withdrawable_balance + ?,
          total_earned = total_earned + ?,
          updated_at = datetime('now')
      WHERE user_id = ?
    `).run(amount, amount > 0 ? amount : 0, userId);
    return this.getByUserId(userId);
  }

  /**
   * Debit for rejected sale adjustment (negative adjustment).
   * The advance paid for a rejected sale must be recovered.
   */
  static debitAdjustment(userId, amount) {
    const db = getDatabase();
    db.prepare(`
      UPDATE user_balances 
      SET withdrawable_balance = withdrawable_balance - ?,
          adjustment_balance = adjustment_balance - ?,
          updated_at = datetime('now')
      WHERE user_id = ?
    `).run(amount, amount, userId);
    return this.getByUserId(userId);
  }

  /**
   * Debit withdrawal from user's balance.
   * Also updates last_withdrawal_at timestamp.
   */
  static debitWithdrawal(userId, amount) {
    const db = getDatabase();
    db.prepare(`
      UPDATE user_balances 
      SET withdrawable_balance = withdrawable_balance - ?,
          last_withdrawal_at = datetime('now'),
          updated_at = datetime('now')
      WHERE user_id = ?
    `).run(amount, userId);
    return this.getByUserId(userId);
  }

  /**
   * Credit back a failed/cancelled/rejected payout.
   */
  static creditReversal(userId, amount) {
    const db = getDatabase();
    db.prepare(`
      UPDATE user_balances 
      SET withdrawable_balance = withdrawable_balance + ?,
          updated_at = datetime('now')
      WHERE user_id = ?
    `).run(amount, userId);
    return this.getByUserId(userId);
  }

  /**
   * Check if user can withdraw (24-hour restriction).
   * Returns { allowed: boolean, nextAllowedAt: string | null }
   */
  static canWithdraw(userId) {
    const balance = this.getByUserId(userId);
    
    if (!balance.last_withdrawal_at) {
      return { allowed: true, nextAllowedAt: null };
    }

    const lastWithdrawal = new Date(balance.last_withdrawal_at + 'Z');
    const now = new Date();
    const hoursSince = (now - lastWithdrawal) / (1000 * 60 * 60);
    
    if (hoursSince >= 24) {
      return { allowed: true, nextAllowedAt: null };
    }

    const nextAllowed = new Date(lastWithdrawal.getTime() + 24 * 60 * 60 * 1000);
    return { 
      allowed: false, 
      nextAllowedAt: nextAllowed.toISOString(),
      hoursRemaining: Math.ceil(24 - hoursSince)
    };
  }
}

module.exports = UserBalance;
