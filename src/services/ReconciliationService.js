/**
 * Reconciliation Service
 * 
 * Handles the admin reconciliation workflow where pending sales are
 * updated to 'approved' or 'rejected', and final payouts are calculated.
 */

const { getDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const Sale = require('../models/Sale');
const UserBalance = require('../models/UserBalance');
const PayoutTransaction = require('../models/PayoutTransaction');

class ReconciliationService {
  /**
   * Reconcile a single sale.
   * 
   * @param {string} saleId - The sale to reconcile
   * @param {string} newStatus - 'approved' or 'rejected'
   * @returns {Object} Reconciliation result with financial details
   */
  static reconcileSale(saleId, newStatus) {
    const db = getDatabase();
    const sale = Sale.findById(saleId);

    if (!sale) {
      throw new Error(`Sale ${saleId} not found.`);
    }
    if (sale.status !== 'pending') {
      throw new Error(`Sale ${saleId} is already '${sale.status}'. Cannot reconcile.`);
    }

    let result;

    const run = db.transaction(() => {
      // Update the sale status
      Sale.updateStatus(saleId, newStatus);

      if (newStatus === 'approved') {
        // Approved: credit remaining amount (earning - advance)
        const remainingAmount = +(sale.earning - sale.advance_amount).toFixed(2);

        UserBalance.creditReconciliation(sale.user_id, remainingAmount);

        PayoutTransaction.create({
          userId: sale.user_id,
          type: 'reconciliation_credit',
          amount: remainingAmount,
          referenceId: saleId,
          description: `Approved sale ${saleId}: ₹${sale.earning} earning - ₹${sale.advance_amount} advance = ₹${remainingAmount} credit`
        });

        result = {
          saleId,
          status: 'approved',
          earning: sale.earning,
          advancePaid: sale.advance_amount,
          finalCredit: remainingAmount,
          adjustment: 0
        };

      } else if (newStatus === 'rejected') {
        // Rejected: debit back the advance amount
        const debitAmount = +sale.advance_amount.toFixed(2);

        if (debitAmount > 0) {
          UserBalance.debitAdjustment(sale.user_id, debitAmount);

          PayoutTransaction.create({
            userId: sale.user_id,
            type: 'reconciliation_debit',
            amount: debitAmount,
            referenceId: saleId,
            description: `Rejected sale ${saleId}: advance of ₹${debitAmount} clawed back`
          });
        }

        result = {
          saleId,
          status: 'rejected',
          earning: sale.earning,
          advancePaid: sale.advance_amount,
          finalCredit: 0,
          adjustment: -debitAmount
        };
      }
    });

    run();
    return result;
  }

  /**
   * Batch reconciliation: reconcile multiple sales at once.
   * 
   * @param {Array<{saleId: string, status: string}>} reconciliations
   * @returns {Object} Batch reconciliation summary
   */
  static reconcileBatch(reconciliations) {
    const db = getDatabase();
    const logId = uuidv4();
    const results = [];
    let totalCredits = 0;
    let totalDebits = 0;

    const run = db.transaction(() => {
      for (const { saleId, status } of reconciliations) {
        try {
          const result = this.reconcileSale(saleId, status);
          results.push({ success: true, ...result });

          if (result.finalCredit > 0) totalCredits += result.finalCredit;
          if (result.adjustment < 0) totalDebits += Math.abs(result.adjustment);
        } catch (error) {
          results.push({ 
            success: false, 
            saleId, 
            error: error.message 
          });
        }
      }

      // Log the reconciliation batch
      db.prepare(`
        INSERT INTO reconciliation_logs (id, sales_processed, total_credits, total_debits)
        VALUES (?, ?, ?, ?)
      `).run(logId, results.filter(r => r.success).length, totalCredits, totalDebits);
    });

    run();

    return {
      batchId: logId,
      total: reconciliations.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      totalCredits: +totalCredits.toFixed(2),
      totalDebits: +totalDebits.toFixed(2),
      netPayout: +(totalCredits - totalDebits).toFixed(2),
      results
    };
  }

  /**
   * Get a reconciliation summary for a user.
   * Shows what the final payout would be given current sale statuses.
   */
  static getUserReconciliationSummary(userId) {
    const db = getDatabase();
    
    const salesSummary = Sale.getSummaryByUser(userId);
    const balance = UserBalance.getByUserId(userId);
    
    return {
      userId,
      salesSummary,
      balance: {
        withdrawable: balance.withdrawable_balance,
        totalEarned: balance.total_earned,
        totalAdvancePaid: balance.total_advance_paid,
        adjustments: balance.adjustment_balance
      }
    };
  }
}

module.exports = ReconciliationService;
