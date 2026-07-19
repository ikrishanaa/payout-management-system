/**
 * Reconciliation API Routes
 * 
 * Endpoints:
 *   POST   /api/reconciliation/sale        — Reconcile a single sale
 *   POST   /api/reconciliation/batch       — Reconcile multiple sales
 *   GET    /api/reconciliation/summary/:userId — Get reconciliation summary
 */

const express = require('express');
const router = express.Router();
const ReconciliationService = require('../services/ReconciliationService');

/**
 * POST /api/reconciliation/sale
 * Body: { saleId, status }
 * Reconcile a single sale (admin action).
 */
router.post('/sale', (req, res) => {
  const { saleId, status } = req.body;

  if (!saleId || !status) {
    return res.status(400).json({
      success: false,
      error: { message: 'saleId and status are required.' }
    });
  }

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({
      success: false,
      error: { message: "status must be 'approved' or 'rejected'." }
    });
  }

  try {
    const result = ReconciliationService.reconcileSale(saleId, status);
    res.json({ success: true, data: result });
  } catch (error) {
    const statusCode = error.message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({ success: false, error: { message: error.message } });
  }
});

/**
 * POST /api/reconciliation/batch
 * Body: { reconciliations: [{ saleId, status }, ...] }
 * Reconcile multiple sales in one batch (atomic).
 */
router.post('/batch', (req, res) => {
  const { reconciliations } = req.body;

  if (!reconciliations || !Array.isArray(reconciliations) || reconciliations.length === 0) {
    return res.status(400).json({
      success: false,
      error: { message: 'reconciliations array is required and must not be empty.' }
    });
  }

  // Validate each entry
  for (const r of reconciliations) {
    if (!r.saleId || !r.status) {
      return res.status(400).json({
        success: false,
        error: { message: 'Each reconciliation must have saleId and status.' }
      });
    }
    if (!['approved', 'rejected'].includes(r.status)) {
      return res.status(400).json({
        success: false,
        error: { message: `Invalid status '${r.status}' for sale ${r.saleId}.` }
      });
    }
  }

  try {
    const result = ReconciliationService.reconcileBatch(reconciliations);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

/**
 * GET /api/reconciliation/summary/:userId
 * Get a reconciliation/balance summary for a user.
 */
router.get('/summary/:userId', (req, res) => {
  try {
    const summary = ReconciliationService.getUserReconciliationSummary(req.params.userId);
    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

module.exports = router;
