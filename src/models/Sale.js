/**
 * Sale Model
 * 
 * Encapsulates all data access for the `sales` table.
 * 
 * - The `advance_paid` flag is the key idempotency mechanism — once set to 1,
 *   the advance payout job will skip that sale on subsequent runs.
 */

const { getDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Sale {
  /**
   * Create a new sale in 'pending' status.
   */
  static create({ userId, brandId, earning }) {
    const db = getDatabase();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO sales (id, user_id, brand_id, status, earning)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(id, userId, brandId, earning);
    return this.findById(id);
  }

  /**
   * Find a single sale by ID.
   */
  static findById(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  }

  /**
   * Get all sales for a user, optionally filtered by status.
   */
  static findByUserId(userId, status = null) {
    const db = getDatabase();
    if (status) {
      return db.prepare('SELECT * FROM sales WHERE user_id = ? AND status = ?')
        .all(userId, status);
    }
    return db.prepare('SELECT * FROM sales WHERE user_id = ?').all(userId);
  }

  /**
   * Get all pending sales that have NOT yet received an advance payout.
   * This is the core query for the advance payout job.
   * 
   * Key: `advance_paid = 0` ensures idempotency — running the job
   * multiple times won't create duplicate advances.
   */
  static findEligibleForAdvance(userId = null) {
    const db = getDatabase();
    if (userId) {
      return db.prepare(`
        SELECT * FROM sales 
        WHERE status = 'pending' AND advance_paid = 0 AND user_id = ?
      `).all(userId);
    }
    return db.prepare(`
      SELECT * FROM sales 
      WHERE status = 'pending' AND advance_paid = 0
    `).all();
  }

  /**
   * Mark a sale as having received its advance payout.
   * Sets `advance_paid = 1` and records the advance amount.
   * 
   * Uses a WHERE guard: only updates if advance_paid is still 0.
   * Returns the number of rows changed (0 = already paid, 1 = success).
   * This provides atomic idempotency at the DB level.
   */
  static markAdvancePaid(saleId, advanceAmount) {
    const db = getDatabase();
    const result = db.prepare(`
      UPDATE sales 
      SET advance_paid = 1, 
          advance_amount = ?,
          updated_at = datetime('now')
      WHERE id = ? AND advance_paid = 0
    `).run(advanceAmount, saleId);
    return result.changes;
  }

  /**
   * Update sale status during reconciliation.
   * Only allows transitions from 'pending' → 'approved' or 'pending' → 'rejected'.
   */
  static updateStatus(saleId, newStatus) {
    if (!['approved', 'rejected'].includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}. Must be 'approved' or 'rejected'.`);
    }

    const db = getDatabase();
    const sale = this.findById(saleId);
    if (!sale) {
      throw new Error(`Sale ${saleId} not found.`);
    }
    if (sale.status !== 'pending') {
      throw new Error(`Sale ${saleId} is already '${sale.status}'. Can only reconcile 'pending' sales.`);
    }

    db.prepare(`
      UPDATE sales 
      SET status = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `).run(newStatus, saleId);

    return this.findById(saleId);
  }

  /**
   * Get pending sales for a specific user (used in reconciliation).
   */
  static findPendingByUserId(userId) {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM sales WHERE user_id = ? AND status = 'pending'
    `).all(userId);
  }

  /**
   * Get a summary of sales for a user grouped by status.
   */
  static getSummaryByUser(userId) {
    const db = getDatabase();
    return db.prepare(`
      SELECT 
        status,
        COUNT(*) as count,
        SUM(earning) as total_earnings,
        SUM(advance_amount) as total_advance
      FROM sales 
      WHERE user_id = ?
      GROUP BY status
    `).all(userId);
  }

  /**
   * Get all sales (with optional filters).
   */
  static findAll({ status, userId, brandId, limit = 100, offset = 0 } = {}) {
    const db = getDatabase();
    let query = 'SELECT * FROM sales WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }
    if (brandId) {
      query += ' AND brand_id = ?';
      params.push(brandId);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return db.prepare(query).all(...params);
  }
}

module.exports = Sale;
