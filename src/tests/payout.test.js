/**
 * Integration Tests
 * 
 * Tests the complete payout workflow using the exact example from the assignment:
 * - 3 pending sales of ₹40 each for john_doe
 * - Advance payout of 10% = ₹12 total (₹4 each)
 * - Reconciliation: 1 rejected, 2 approved
 * - Final payout: -₹4 + ₹36 + ₹36 = ₹68
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Use in-memory database for tests — set BEFORE requiring modules
process.env.DB_PATH = ':memory:';

const { getDatabase, closeDatabase } = require('../config/database');
const { migrate } = require('../scripts/migrate');

const Sale = require('../models/Sale');
const UserBalance = require('../models/UserBalance');
const Payout = require('../models/Payout');
const PayoutTransaction = require('../models/PayoutTransaction');
const AdvancePayoutService = require('../services/AdvancePayoutService');
const ReconciliationService = require('../services/ReconciliationService');
const WithdrawalService = require('../services/WithdrawalService');

/**
 * Helper: Set up a clean database with test fixtures
 */
function setupTestDB() {
  const db = getDatabase();
  migrate();
  // Clear all data
  db.exec(`
    DELETE FROM payout_transactions;
    DELETE FROM payouts;
    DELETE FROM reconciliation_logs;
    DELETE FROM user_balances;
    DELETE FROM sales;
    DELETE FROM brands;
    DELETE FROM users;
  `);
  // Insert test fixtures
  db.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)').run('john_doe', 'John Doe', 'john@test.com');
  db.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)').run('edge_user', 'Edge User', 'edge@test.com');
  db.prepare('INSERT INTO brands (id, name) VALUES (?, ?)').run('brand_1', 'Brand 1');
  db.prepare('INSERT INTO brands (id, name) VALUES (?, ?)').run('brand_2', 'Brand 2');
  db.prepare('INSERT INTO user_balances (user_id) VALUES (?)').run('john_doe');
  db.prepare('INSERT INTO user_balances (user_id) VALUES (?)').run('edge_user');
}

describe('Payout Management System — Full Workflow', () => {
  let saleIds = [];

  before(() => {
    setupTestDB();
  });

  // DB cleanup happens at process exit (shared in-memory DB with Edge Cases suite)

  // ────────────────────────────────────────────────────────
  // STEP 1: Create 3 pending sales of ₹40 each
  // ────────────────────────────────────────────────────────
  describe('Step 1: Create Sales', () => {
    it('should create 3 pending sales of ₹40 each', () => {
      for (let i = 0; i < 3; i++) {
        const sale = Sale.create({ userId: 'john_doe', brandId: 'brand_1', earning: 40 });
        saleIds.push(sale.id);
        assert.equal(sale.status, 'pending');
        assert.equal(sale.earning, 40);
        assert.equal(sale.advance_paid, 0);
      }
      assert.equal(saleIds.length, 3);
    });
  });

  // ────────────────────────────────────────────────────────
  // STEP 2: Process advance payouts (10% = ₹4 each = ₹12)
  // ────────────────────────────────────────────────────────
  describe('Step 2: Advance Payouts', () => {
    it('should process advance of 10% for each pending sale', () => {
      const result = AdvancePayoutService.processForUser('john_doe');
      assert.equal(result.processed, 3);
      assert.equal(result.totalAdvanced, 12); // 3 × ₹4
    });

    it('should mark all sales as advance_paid', () => {
      for (const id of saleIds) {
        const sale = Sale.findById(id);
        assert.equal(sale.advance_paid, 1);
        assert.equal(sale.advance_amount, 4);
      }
    });

    it('should credit ₹12 to user withdrawable balance', () => {
      const balance = UserBalance.getByUserId('john_doe');
      assert.equal(balance.withdrawable_balance, 12);
      assert.equal(balance.total_advance_paid, 12);
    });

    it('should be idempotent — re-running produces no duplicates', () => {
      const result = AdvancePayoutService.processForUser('john_doe');
      assert.equal(result.processed, 0);
      assert.equal(result.totalAdvanced, 0);

      const balance = UserBalance.getByUserId('john_doe');
      assert.equal(balance.withdrawable_balance, 12); // unchanged
    });
  });

  // ────────────────────────────────────────────────────────
  // STEP 3: Reconciliation (1 rejected, 2 approved)
  // ────────────────────────────────────────────────────────
  describe('Step 3: Reconciliation', () => {
    it('should reject sale 1 and debit ₹4 advance', () => {
      const result = ReconciliationService.reconcileSale(saleIds[0], 'rejected');
      assert.equal(result.status, 'rejected');
      assert.equal(result.adjustment, -4);
    });

    it('should approve sale 2 and credit ₹36', () => {
      const result = ReconciliationService.reconcileSale(saleIds[1], 'approved');
      assert.equal(result.status, 'approved');
      assert.equal(result.finalCredit, 36); // ₹40 - ₹4
    });

    it('should approve sale 3 and credit ₹36', () => {
      const result = ReconciliationService.reconcileSale(saleIds[2], 'approved');
      assert.equal(result.status, 'approved');
      assert.equal(result.finalCredit, 36);
    });

    it('should result in withdrawable balance of ₹80 (advance ₹12 + reconciliation net ₹68)', () => {
      const balance = UserBalance.getByUserId('john_doe');
      // Balance evolution:
      //   After advance:       +12 → 12
      //   Rejected (debit):    -4  → 8
      //   Approved (credit):   +36 → 44
      //   Approved (credit):   +36 → 80
      //
      // The assignment says "Final Payout = ₹68". That ₹68 is the ADDITIONAL payout
      // after the ₹12 advance was already paid. Total received = 12 + 68 = 80.
      // Our system tracks the full withdrawable balance (₹80) since the advance
      // is still sitting in the balance if not yet withdrawn.
      assert.equal(balance.withdrawable_balance, 80);
    });

    it('should prevent re-reconciling an already reconciled sale', () => {
      assert.throws(() => {
        ReconciliationService.reconcileSale(saleIds[0], 'approved');
      }, { message: /already/ });
    });
  });

  // ────────────────────────────────────────────────────────
  // STEP 4: Withdrawal
  // ────────────────────────────────────────────────────────
  describe('Step 4: Withdrawal', () => {
    let payoutId;

    it('should allow withdrawal of ₹80', () => {
      const result = WithdrawalService.initiateWithdrawal('john_doe', 80);
      payoutId = result.payout.id;
      assert.equal(result.payout.amount, 80);
      assert.equal(result.payout.status, 'pending');
      assert.equal(result.remainingBalance, 0);
    });

    it('should reject a second withdrawal within 24 hours', () => {
      // Credit some balance so we can attempt another withdrawal
      const db = getDatabase();
      db.prepare(`UPDATE user_balances SET withdrawable_balance = 10 WHERE user_id = ?`).run('john_doe');

      assert.throws(() => {
        WithdrawalService.initiateWithdrawal('john_doe', 10);
      }, { message: /restricted/ });
    });

    it('should reject withdrawal with insufficient balance', () => {
      // Reset withdrawal time to allow withdrawal
      const db = getDatabase();
      db.prepare(`UPDATE user_balances SET last_withdrawal_at = datetime('now', '-25 hours') WHERE user_id = ?`)
        .run('john_doe');

      assert.throws(() => {
        WithdrawalService.initiateWithdrawal('john_doe', 9999);
      }, { message: /Insufficient/ });
    });
  });

  // ────────────────────────────────────────────────────────
  // STEP 5: Failed Payout Recovery (Question 2)
  // ────────────────────────────────────────────────────────
  describe('Step 5: Failed Payout Recovery', () => {
    let failedPayoutId;

    it('should create a payout then mark it as failed and credit back balance', () => {
      // Reset withdrawal time
      const db = getDatabase();
      db.prepare(`UPDATE user_balances SET last_withdrawal_at = datetime('now', '-25 hours') WHERE user_id = ?`)
        .run('john_doe');

      const balanceBefore = UserBalance.getByUserId('john_doe').withdrawable_balance;
      const result = WithdrawalService.initiateWithdrawal('john_doe', 5);
      failedPayoutId = result.payout.id;

      const balanceAfterWithdrawal = UserBalance.getByUserId('john_doe').withdrawable_balance;
      assert.equal(balanceAfterWithdrawal, balanceBefore - 5);

      const recovery = WithdrawalService.handleFailedPayout(failedPayoutId, 'failed', 'Bank rejected');
      assert.equal(recovery.payout.status, 'failed');
      assert.equal(recovery.restoredAmount, 5);
      assert.equal(recovery.newBalance, balanceBefore); // fully restored
    });

    it('should not allow marking an already failed payout as failed again', () => {
      assert.throws(() => {
        WithdrawalService.handleFailedPayout(failedPayoutId, 'failed');
      }, { message: /not 'pending'/ });
    });
  });

  // ────────────────────────────────────────────────────────
  // STEP 6: Transaction Audit Log
  // ────────────────────────────────────────────────────────
  describe('Step 6: Audit & Verification', () => {
    it('should have a complete transaction log', () => {
      const transactions = PayoutTransaction.findByUserId('john_doe');
      assert.ok(transactions.length > 0);

      const types = transactions.map(t => t.type);
      assert.ok(types.includes('advance'));
      assert.ok(types.includes('reconciliation_credit'));
      assert.ok(types.includes('reconciliation_debit'));
      assert.ok(types.includes('withdrawal'));
      assert.ok(types.includes('withdrawal_reversal'));
    });

    it('should have internally consistent transaction log', () => {
      const computed = PayoutTransaction.computeBalanceFromLog('john_doe');
      assert.ok(typeof computed.computed_balance === 'number');
      assert.equal(
        +(computed.total_credits - computed.total_debits).toFixed(2),
        +computed.computed_balance.toFixed(2)
      );
    });
  });
});

describe('Edge Cases', () => {
  it('should handle zero-earning sale advance (₹0 × 10% = ₹0)', () => {
    const sale = Sale.create({ userId: 'edge_user', brandId: 'brand_2', earning: 0 });
    // Process just this one sale
    const advanceAmount = +(0 * 0.10).toFixed(2);
    const changed = Sale.markAdvancePaid(sale.id, advanceAmount);
    assert.equal(changed, 1);
    assert.equal(advanceAmount, 0);
  });

  it('should handle sale with no advance when reconciled', () => {
    // Create sale without running advance job
    const sale = Sale.create({ userId: 'edge_user', brandId: 'brand_2', earning: 100 });
    // Reconcile directly (advance_amount = 0)
    const result = ReconciliationService.reconcileSale(sale.id, 'approved');
    assert.equal(result.finalCredit, 100); // full earning, no advance to subtract
  });

  it('should reject invalid status values', () => {
    const sale = Sale.create({ userId: 'edge_user', brandId: 'brand_2', earning: 50 });
    assert.throws(() => {
      Sale.updateStatus(sale.id, 'invalid_status');
    });
  });

  it('should handle concurrent advance payout attempts (idempotency)', () => {
    const sale = Sale.create({ userId: 'edge_user', brandId: 'brand_2', earning: 200 });

    // Simulate two concurrent advance attempts
    const changed1 = Sale.markAdvancePaid(sale.id, 20);
    const changed2 = Sale.markAdvancePaid(sale.id, 20);

    assert.equal(changed1, 1); // first succeeds
    assert.equal(changed2, 0); // second is a no-op
  });

  it('should handle cancelled payout recovery', () => {
    // Reset withdrawal time for edge_user
    const db = getDatabase();
    db.prepare(`UPDATE user_balances SET last_withdrawal_at = NULL WHERE user_id = ?`).run('edge_user');
    
    // Give edge_user some balance
    db.prepare(`UPDATE user_balances SET withdrawable_balance = 500 WHERE user_id = ?`).run('edge_user');

    const result = WithdrawalService.initiateWithdrawal('edge_user', 100);
    const recovery = WithdrawalService.handleFailedPayout(result.payout.id, 'cancelled', 'User cancelled');
    assert.equal(recovery.payout.status, 'cancelled');
    assert.equal(recovery.restoredAmount, 100);
  });

  it('should handle rejected payout recovery', () => {
    const db = getDatabase();
    db.prepare(`UPDATE user_balances SET last_withdrawal_at = datetime('now', '-25 hours') WHERE user_id = ?`).run('edge_user');

    const result = WithdrawalService.initiateWithdrawal('edge_user', 50);
    const recovery = WithdrawalService.handleFailedPayout(result.payout.id, 'rejected', 'Payment provider rejected');
    assert.equal(recovery.payout.status, 'rejected');
    assert.equal(recovery.restoredAmount, 50);
  });
});
