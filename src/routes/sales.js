/**
 * Sales API Routes
 * 
 * Endpoints:
 *   GET    /api/sales              — List all sales (with filters)
 *   GET    /api/sales/:id          — Get a specific sale
 *   POST   /api/sales              — Create a new sale
 *   GET    /api/sales/user/:userId — Get sales for a specific user
 */

const express = require('express');
const router = express.Router();
const Sale = require('../models/Sale');
const UserBalance = require('../models/UserBalance');

/**
 * GET /api/sales
 * Query params: status, userId, brandId, limit, offset
 */
router.get('/', (req, res) => {
  const { status, userId, brandId, limit, offset } = req.query;
  const sales = Sale.findAll({
    status,
    userId,
    brandId,
    limit: parseInt(limit) || 100,
    offset: parseInt(offset) || 0
  });
  res.json({ success: true, data: sales, count: sales.length });
});

/**
 * GET /api/sales/:id
 */
router.get('/:id', (req, res) => {
  const sale = Sale.findById(req.params.id);
  if (!sale) {
    return res.status(404).json({ success: false, error: { message: 'Sale not found.' } });
  }
  res.json({ success: true, data: sale });
});

/**
 * POST /api/sales
 * Body: { userId, brandId, earning }
 */
router.post('/', (req, res) => {
  const { userId, brandId, earning } = req.body;

  if (!userId || !brandId || earning === undefined) {
    return res.status(400).json({
      success: false,
      error: { message: 'userId, brandId, and earning are required.' }
    });
  }

  if (typeof earning !== 'number' || earning < 0) {
    return res.status(400).json({
      success: false,
      error: { message: 'earning must be a non-negative number.' }
    });
  }

  try {
    // Ensure user balance record exists
    UserBalance.getByUserId(userId);

    const sale = Sale.create({ userId, brandId, earning });
    res.status(201).json({ success: true, data: sale });
  } catch (error) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

/**
 * GET /api/sales/user/:userId
 * Query params: status
 */
router.get('/user/:userId', (req, res) => {
  const { status } = req.query;
  const sales = Sale.findByUserId(req.params.userId, status);
  const summary = Sale.getSummaryByUser(req.params.userId);
  res.json({ success: true, data: sales, summary, count: sales.length });
});

module.exports = router;
