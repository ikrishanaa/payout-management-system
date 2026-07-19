/**
 * Advance Payout Service
 * 
 * Implements the advance payout job: credits 10% of earnings for eligible
 * pending sales to the user's withdrawable balance.
 */

const { getDatabase } = require('../config/database');
const Sale = require('../models/Sale');
const UserBalance = require('../models/UserBalance');
const PayoutTransaction = require('../models/PayoutTransaction');

const ADVANCE_RATE = 0.10; // 10%

class AdvancePayoutService {
  /**
   * Process advance payouts for all eligible pending sales.
   * Groups by user for efficient batch processing.
   * 
   * @returns {Object} Summary of the advance payout run.
   */
  static processAll() {
    const db = getDatabase();
    const eligibleSales = Sale.findEligibleForAdvance();

    if (eligibleSales.length === 0) {
      return { 
        processed: 0, 
        skipped: 0, 
        totalAdvanced: 0, 
        message: 'No eligible sales for advance payout.' 
      };
    }

    let processed = 0;
    let skipped = 0;
    let totalAdvanced = 0;

    // Wrap in transaction for atomicity
    const run = db.transaction(() => {
      for (const sale of eligibleSales) {
        const advanceAmount = +(sale.earning * ADVANCE_RATE).toFixed(2);

        // Atomic check-and-set: returns 0 if already marked
        const changed = Sale.markAdvancePaid(sale.id, advanceAmount);

        if (changed === 0) {
          // Another process already handled this sale — skip
          skipped++;
          continue;
        }

        // Credit the user's balance
        UserBalance.creditAdvance(sale.user_id, advanceAmount);

        // Record in the audit log
        PayoutTransaction.create({
          userId: sale.user_id,
          type: 'advance',
          amount: advanceAmount,
          referenceId: sale.id,
          description: `Advance payout (10%) for sale ${sale.id} — earning ₹${sale.earning}`
        });

        processed++;
        totalAdvanced += advanceAmount;
      }
    });

    run();

    return {
      processed,
      skipped,
      totalAdvanced: +totalAdvanced.toFixed(2),
      message: `Advance payouts processed: ${processed} sales, ₹${totalAdvanced.toFixed(2)} total.`
    };
  }

  /**
   * Process advance payouts for a specific user only.
   */
  static processForUser(userId) {
    const db = getDatabase();
    const eligibleSales = Sale.findEligibleForAdvance(userId);

    if (eligibleSales.length === 0) {
      return {
        processed: 0,
        skipped: 0,
        totalAdvanced: 0,
        message: `No eligible sales for user ${userId}.`
      };
    }

    let processed = 0;
    let skipped = 0;
    let totalAdvanced = 0;

    const run = db.transaction(() => {
      for (const sale of eligibleSales) {
        const advanceAmount = +(sale.earning * ADVANCE_RATE).toFixed(2);
        const changed = Sale.markAdvancePaid(sale.id, advanceAmount);

        if (changed === 0) {
          skipped++;
          continue;
        }

        UserBalance.creditAdvance(sale.user_id, advanceAmount);

        PayoutTransaction.create({
          userId: sale.user_id,
          type: 'advance',
          amount: advanceAmount,
          referenceId: sale.id,
          description: `Advance payout (10%) for sale ${sale.id} — earning ₹${sale.earning}`
        });

        processed++;
        totalAdvanced += advanceAmount;
      }
    });

    run();

    return {
      processed,
      skipped,
      totalAdvanced: +totalAdvanced.toFixed(2),
      message: `Advance payouts for ${userId}: ${processed} sales, ₹${totalAdvanced.toFixed(2)} total.`
    };
  }
}

module.exports = AdvancePayoutService;
