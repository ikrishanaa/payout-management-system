/**
 * Express Server — Entry Point
 * 
 * Mounts all API routes and initializes the database.
 * 
 * API Overview:
 * ─────────────
 *   /api/sales            — CRUD for sales
 *   /api/advance          — Advance payout processing
 *   /api/reconciliation   — Admin reconciliation
 *   /api/payouts          — Withdrawals & failed payout recovery
 *   /api/balance          — User balance & transaction history
 */

const express = require('express');
const { migrate } = require('./scripts/migrate');
const { closeDatabase } = require('./config/database');
const { errorHandler } = require('./middleware/errorHandler');

// Route imports
const salesRoutes = require('./routes/sales');
const advanceRoutes = require('./routes/advance');
const reconciliationRoutes = require('./routes/reconciliation');
const payoutRoutes = require('./routes/payouts');
const balanceRoutes = require('./routes/balance');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Initialize Database ──
migrate();

// ── Mount Routes ──
app.use('/api/sales', salesRoutes);
app.use('/api/advance', advanceRoutes);
app.use('/api/reconciliation', reconciliationRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/balance', balanceRoutes);

// ── Health Check ──
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── API Documentation ──
app.get('/', (req, res) => {
  res.json({
    name: 'User Payout Management System',
    version: '1.0.0',
    description: 'Manages user payouts for affiliate sales',
    endpoints: {
      sales: {
        'GET    /api/sales':               'List all sales (query: status, userId, brandId)',
        'GET    /api/sales/:id':           'Get sale by ID',
        'POST   /api/sales':              'Create a new sale { userId, brandId, earning }',
        'GET    /api/sales/user/:userId':  'Get sales for a user (query: status)',
      },
      advance: {
        'POST   /api/advance/process':          'Run advance payout job (all users)',
        'POST   /api/advance/process/:userId':  'Run advance payout for specific user',
      },
      reconciliation: {
        'POST   /api/reconciliation/sale':             'Reconcile single sale { saleId, status }',
        'POST   /api/reconciliation/batch':            'Batch reconcile { reconciliations: [...] }',
        'GET    /api/reconciliation/summary/:userId':  'Get reconciliation summary',
      },
      payouts: {
        'POST   /api/payouts/withdraw':       'Initiate withdrawal { userId, amount }',
        'POST   /api/payouts/:id/fail':       'Mark payout failed { status, reason }',
        'POST   /api/payouts/:id/complete':   'Mark payout completed',
        'GET    /api/payouts/user/:userId':    'Get withdrawal history',
        'GET    /api/payouts/:id':            'Get payout details',
      },
      balance: {
        'GET    /api/balance/:userId':               'Get user balance',
        'GET    /api/balance/:userId/transactions':   'Transaction history',
        'GET    /api/balance/:userId/verify':         'Verify balance consistency',
      },
      health: {
        'GET    /health': 'Health check',
      }
    }
  });
});

// ── Error Handler ──
app.use(errorHandler);

// ── Graceful Shutdown ──
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDatabase();
  process.exit(0);
});

// ── Start Server ──
app.listen(PORT, () => {
  console.log(`\n🚀 Payout Management System running on http://localhost:${PORT}`);
  console.log(`📋 API docs: http://localhost:${PORT}/`);
  console.log(`💚 Health:   http://localhost:${PORT}/health\n`);
});

module.exports = app;
