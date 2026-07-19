/**
 * Withdrawal & Payout API Routes
 * 
 * Endpoints:
 *   POST   /api/payouts/withdraw             — Initiate a withdrawal
 *   POST   /api/payouts/:id/fail             — Mark payout as failed (recovery)
 *   POST   /api/payouts/:id/complete         — Mark payout as completed
 *   GET    /api/payouts/user/:userId         — Get withdrawal history
 *   GET    /api/payouts/:id                  — Get payout details
 */

const express = require('express');
const router = express.Router();
const WithdrawalService = require('../services/WithdrawalService');
const Payout = require('../models/Payout');

/**
 * POST /api/payouts/withdraw
 * Body: { userId, amount }
 * Initiate a withdrawal request.
 */
router.post('/withdraw', (req, res) => {
  const { userId, amount } = req.body;

  if (!userId || !amount) {
    return res.status(400).json({
      success: false,
      error: { message: 'userId and amount are required.' }
    });
  }

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({
      success: false,
      error: { message: 'amount must be a positive number.' }
    });
  }

  try {
    const result = WithdrawalService.initiateWithdrawal(userId, amount);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    // Determine appropriate status code from error message
    let statusCode = 400;
    if (error.message.includes('not found')) statusCode = 404;
    if (error.message.includes('restricted')) statusCode = 429;
    
    res.status(statusCode).json({ success: false, error: { message: error.message } });
  }
});

/**
 * POST /api/payouts/:id/fail
 * Body: { status, reason }
 * Mark a payout as failed/cancelled/rejected and credit back balance.
 * This is the Failed Payout Recovery endpoint (Question 2).
 */
router.post('/:id/fail', (req, res) => {
  const { status, reason } = req.body;
  const validStatuses = ['failed', 'cancelled', 'rejected'];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      error: { message: `status must be one of: ${validStatuses.join(', ')}` }
    });
  }

  try {
    const result = WithdrawalService.handleFailedPayout(req.params.id, status, reason);
    res.json({ success: true, data: result });
  } catch (error) {
    const statusCode = error.message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({ success: false, error: { message: error.message } });
  }
});

/**
 * POST /api/payouts/:id/complete
 * Mark a payout as completed (successful transfer).
 */
router.post('/:id/complete', (req, res) => {
  try {
    const payout = WithdrawalService.completePayout(req.params.id);
    res.json({ success: true, data: payout });
  } catch (error) {
    const statusCode = error.message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({ success: false, error: { message: error.message } });
  }
});

/**
 * GET /api/payouts/user/:userId
 * Query params: status
 */
router.get('/user/:userId', (req, res) => {
  const { status } = req.query;
  const payouts = status 
    ? Payout.findByUserId(req.params.userId, status)
    : Payout.findByUserId(req.params.userId);
  res.json({ success: true, data: payouts, count: payouts.length });
});

/**
 * GET /api/payouts/:id
 */
router.get('/:id', (req, res) => {
  const payout = Payout.findById(req.params.id);
  if (!payout) {
    return res.status(404).json({ success: false, error: { message: 'Payout not found.' } });
  }
  res.json({ success: true, data: payout });
});

module.exports = router;
