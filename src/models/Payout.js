/**
 * Payout Model
 * 
 * Represents withdrawal requests. Tracks the full lifecycle: pending, completed, failed, cancelled, rejected.
 * Failed/cancelled/rejected payouts trigger a reversal (credit back to balance).
 */

const { getDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Payout {
  /**
   * Create a new payout (withdrawal request).
   */
  static create({ userId, amount }) {
    const db = getDatabase();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO payouts (id, user_id, amount, status)
      VALUES (?, ?, ?, 'pending')
    `).run(id, userId, amount);
    return this.findById(id);
  }

  /**
   * Find a payout by ID.
   */
  static findById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM payouts WHERE id = ?').get(id);
  }

  /**
   * Get all payouts for a user.
   */
  static findByUserId(userId, status = null) {
    const db = getDatabase();
    if (status) {
      return db.prepare('SELECT * FROM payouts WHERE user_id = ? AND status = ? ORDER BY created_at DESC')
        .all(userId, status);
    }
    return db.prepare('SELECT * FROM payouts WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId);
  }

  /**
   * Update payout status.
   * Valid transitions:
   *   pending → completed | failed | cancelled | rejected
   */
  static updateStatus(payoutId, newStatus, failureReason = null) {
    const validStatuses = ['completed', 'failed', 'cancelled', 'rejected'];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid payout status: ${newStatus}`);
    }

    const db = getDatabase();
    const payout = this.findById(payoutId);
    if (!payout) {
      throw new Error(`Payout ${payoutId} not found.`);
    }
    if (payout.status !== 'pending') {
      throw new Error(`Payout ${payoutId} is '${payout.status}', not 'pending'. Cannot update.`);
    }

    db.prepare(`
      UPDATE payouts 
      SET status = ?, failure_reason = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newStatus, failureReason, payoutId);

    return this.findById(payoutId);
  }
}

module.exports = Payout;
