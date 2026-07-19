/**
 * Balance & Transaction API Routes
 * 
 * Endpoints:
 *   GET    /api/balance/:userId              — Get user balance
 *   GET    /api/balance/:userId/transactions — Get transaction history
 *   GET    /api/balance/:userId/verify       — Verify balance against transaction log
 */

const express = require('express');
const router = express.Router();
const UserBalance = require('../models/UserBalance');
const PayoutTransaction = require('../models/PayoutTransaction');

/**
 * GET /api/balance/:userId
 * Get the current balance for a user.
 */
router.get('/:userId', (req, res) => {
  try {
    const balance = UserBalance.getByUserId(req.params.userId);
    const canWithdraw = UserBalance.canWithdraw(req.params.userId);
    
    res.json({ 
      success: true, 
      data: {
        ...balance,
        canWithdraw: canWithdraw.allowed,
        nextWithdrawalAt: canWithdraw.nextAllowedAt,
        hoursUntilWithdrawal: canWithdraw.hoursRemaining || 0
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

/**
 * GET /api/balance/:userId/transactions
 * Get the transaction history for a user.
 * Query params: limit, offset
 */
router.get('/:userId/transactions', (req, res) => {
  const { limit, offset } = req.query;
  const transactions = PayoutTransaction.findByUserId(req.params.userId, {
    limit: parseInt(limit) || 50,
    offset: parseInt(offset) || 0
  });
  res.json({ success: true, data: transactions, count: transactions.length });
});

/**
 * GET /api/balance/:userId/verify
 * Verify the materialized balance matches the transaction log.
 * Useful for debugging and auditing.
 */
router.get('/:userId/verify', (req, res) => {
  try {
    const balance = UserBalance.getByUserId(req.params.userId);
    const computed = PayoutTransaction.computeBalanceFromLog(req.params.userId);
    
    const isConsistent = Math.abs(balance.withdrawable_balance - computed.computed_balance) < 0.01;
    
    res.json({
      success: true,
      data: {
        materialized_balance: balance.withdrawable_balance,
        computed_from_log: computed.computed_balance,
        total_credits: computed.total_credits,
        total_debits: computed.total_debits,
        is_consistent: isConsistent,
        drift: +(balance.withdrawable_balance - computed.computed_balance).toFixed(2)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

module.exports = router;
