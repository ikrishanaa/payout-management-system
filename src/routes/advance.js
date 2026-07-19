/**
 * Advance Payout API Routes
 * 
 * Endpoints:
 *   POST   /api/advance/process           — Run advance payout job (all users)
 *   POST   /api/advance/process/:userId   — Run advance payout for specific user
 */

const express = require('express');
const router = express.Router();
const AdvancePayoutService = require('../services/AdvancePayoutService');

/**
 * POST /api/advance/process
 * Trigger the advance payout job for all eligible pending sales.
 * This is idempotent — safe to call multiple times.
 */
router.post('/process', (req, res) => {
  try {
    const result = AdvancePayoutService.processAll();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

/**
 * POST /api/advance/process/:userId
 * Trigger the advance payout job for a specific user's eligible sales.
 */
router.post('/process/:userId', (req, res) => {
  try {
    const result = AdvancePayoutService.processForUser(req.params.userId);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

module.exports = router;
