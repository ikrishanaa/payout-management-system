/**
 * Withdrawal Service
 * 
 * Handles user withdrawal requests and failed payout recovery.
 * 
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║  WITHDRAWAL RULES                                            ║
 * ║                                                               ║
 * ║  1. User must have sufficient withdrawable balance.           ║
 * ║  2. Only one withdrawal every 24 hours.                       ║
 * ║  3. Amount must be > 0.                                       ║
 * ║                                                               ║
 * ║  FAILED PAYOUT RECOVERY (Question 2)                          ║
 * ║                                                               ║
 * ║  If a payout fails/is cancelled/rejected:                     ║
 * ║  1. Credit the amount back to withdrawable balance.           ║
 * ║  2. Record a withdrawal_reversal transaction.                 ║
 * ║  3. User can withdraw again (subject to 24h rule).            ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

const { getDatabase } = require('../config/database');
const Payout = require('../models/Payout');
const UserBalance = require('../models/UserBalance');
const PayoutTransaction = require('../models/PayoutTransaction');

class WithdrawalService {
  /**
   * Initiate a withdrawal for a user.
   * 
   * @param {string} userId
   * @param {number} amount
   * @returns {Object} The created payout record
   * @throws {Error} If validation fails
   */
  static initiateWithdrawal(userId, amount) {
    const db = getDatabase();

    // ── Validation ──
    if (!amount || amount <= 0) {
      throw new Error('Withdrawal amount must be greater than 0.');
    }

    const balance = UserBalance.getByUserId(userId);
    if (!balance) {
      throw new Error(`User ${userId} not found.`);
    }

    // Check 24-hour restriction
    const withdrawalCheck = UserBalance.canWithdraw(userId);
    if (!withdrawalCheck.allowed) {
      throw new Error(
        `Withdrawal restricted. Only one withdrawal per 24 hours. ` +
        `Next allowed at: ${withdrawalCheck.nextAllowedAt} ` +
        `(${withdrawalCheck.hoursRemaining}h remaining).`
      );
    }

    // Check sufficient balance
    if (balance.withdrawable_balance < amount) {
      throw new Error(
        `Insufficient balance. Requested: ₹${amount}, ` +
        `Available: ₹${balance.withdrawable_balance.toFixed(2)}`
      );
    }

    let payout;

    const run = db.transaction(() => {
      // Create the payout record
      payout = Payout.create({ userId, amount });

      // Debit the balance
      UserBalance.debitWithdrawal(userId, amount);

      // Record in audit log
      PayoutTransaction.create({
        userId,
        type: 'withdrawal',
        amount,
        referenceId: payout.id,
        description: `Withdrawal of ₹${amount}`
      });
    });

    run();

    return {
      payout,
      remainingBalance: UserBalance.getByUserId(userId).withdrawable_balance
    };
  }

  /**
   * Handle a failed/cancelled/rejected payout.
   * Credits the amount back to the user's balance.
   * 
   * This is the core of Question 2: Failed Payout Recovery.
   * 
   * @param {string} payoutId
   * @param {string} failureStatus - 'failed' | 'cancelled' | 'rejected'
   * @param {string} reason - Optional reason for the failure
   */
  static handleFailedPayout(payoutId, failureStatus, reason = null) {
    const db = getDatabase();
    const validFailureStatuses = ['failed', 'cancelled', 'rejected'];

    if (!validFailureStatuses.includes(failureStatus)) {
      throw new Error(`Invalid failure status: ${failureStatus}`);
    }

    const payout = Payout.findById(payoutId);
    if (!payout) {
      throw new Error(`Payout ${payoutId} not found.`);
    }
    if (payout.status !== 'pending') {
      throw new Error(`Payout ${payoutId} is '${payout.status}', not 'pending'. Cannot mark as failed.`);
    }

    const run = db.transaction(() => {
      // Update payout status
      Payout.updateStatus(payoutId, failureStatus, reason);

      // Credit the amount back to user's balance
      UserBalance.creditReversal(payout.user_id, payout.amount);

      // Record the reversal in audit log
      PayoutTransaction.create({
        userId: payout.user_id,
        type: 'withdrawal_reversal',
        amount: payout.amount,
        referenceId: payoutId,
        description: `Payout ${failureStatus}: ₹${payout.amount} credited back. ${reason || ''}`
      });
    });

    run();

    return {
      payout: Payout.findById(payoutId),
      restoredAmount: payout.amount,
      newBalance: UserBalance.getByUserId(payout.user_id).withdrawable_balance
    };
  }

  /**
   * Mark a payout as completed (successful transfer).
   */
  static completePayout(payoutId) {
    const payout = Payout.findById(payoutId);
    if (!payout) {
      throw new Error(`Payout ${payoutId} not found.`);
    }
    
    return Payout.updateStatus(payoutId, 'completed');
  }

  /**
   * Get withdrawal history for a user.
   */
  static getWithdrawalHistory(userId) {
    return Payout.findByUserId(userId);
  }
}

module.exports = WithdrawalService;
