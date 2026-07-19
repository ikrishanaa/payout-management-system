# Low-Level Design (LLD) - Payout Management System

## Architecture Overview

The system follows a layered architecture to ensure separation of concerns and maintainability.

```
┌─────────────────────────────────────────────────────────┐
│                     REST API Layer                       │
│  /api/sales  /api/advance  /api/reconciliation          │
│  /api/payouts  /api/balance                             │
├─────────────────────────────────────────────────────────┤
│                    Service Layer                         │
│  AdvancePayoutService  ReconciliationService             │
│  WithdrawalService                                       │
├─────────────────────────────────────────────────────────┤
│                     Model Layer                          │
│  Sale  UserBalance  Payout  PayoutTransaction           │
├─────────────────────────────────────────────────────────┤
│                   Database (SQLite)                       │
│  users │ brands │ sales │ user_balances │ payouts       │
│  payout_transactions │ reconciliation_logs               │
└─────────────────────────────────────────────────────────┘
```

## Module Interactions

### AdvancePayoutService
Orchestrates the disbursement of 10% advance payouts for pending sales.
- **Uses:** `Sale.findEligibleForAdvance()` to get pending, unpaid sales.
- **Uses:** `Sale.markAdvancePaid()` as an idempotency guard (Check-and-Set).
- **Uses:** `UserBalance.creditAdvance()` to update user's withdrawable balance.
- **Uses:** `PayoutTransaction.create()` to record the advance in the audit ledger.

### ReconciliationService
Handles the admin side process of approving or rejecting sales.
- **Uses:** `Sale.updateStatus()` to change sale status (validates transitions).
- **Uses:** `UserBalance.creditReconciliation()` if the sale is approved (credits the remaining 90%).
- **Uses:** `UserBalance.debitAdjustment()` if the sale is rejected (claws back the 10% advance).
- **Uses:** `PayoutTransaction.create()` to log reconciliation credits/debits.

### WithdrawalService
Manages user withdrawal requests and recovery of failed payouts.
- **Uses:** `UserBalance.canWithdraw()` to check the 24-hour business rule constraint and sufficient funds.
- **Uses:** `Payout.create()` to create the payout record (status: processing).
- **Uses:** `UserBalance.debitWithdrawal()` to deduct funds and update the `last_withdrawal_at` timestamp.
- **Uses:** `UserBalance.creditReversal()` to refund the user's balance if a payout is marked as failed.
- **Uses:** `PayoutTransaction.create()` to log the withdrawal or failure reversal.

## Design Decisions & Trade-offs

### 1. Materialized Balance vs. Computed Balance
**Decision:** Maintain a `user_balances` table with pre-computed `withdrawable_balance`.
- **Pros:** O(1) reads, fast withdrawal checks.
- **Cons:** Writes need to update both the balance table and the transaction log.
- **Mitigation:** Database transactions are used to ensure atomicity. An `/api/balance/:userId/verify` endpoint is provided to recompute the balance from the transaction log for auditing, ensuring consistency.

### 2. SQLite
**Decision:** Use SQLite with WAL (Write-Ahead Logging) mode.
- **Pros:** Zero configuration, file-based, easily portable, and ACID-compliant.
- **Cons:** Table-level locking can be a bottleneck under high write concurrency.
- **Trade-off:** Ideal for an assignment/prototype. The Models abstract the SQL, allowing for an easy swap to PostgreSQL in production environments.

### 3. Idempotency via Check-and-Set
**Decision:** Use atomic SQL statements as concurrency guards.
- **Implementation:** `UPDATE sales SET advance_paid = 1 WHERE id = ? AND advance_paid = 0`
- **Benefit:** If two advance payout jobs run concurrently, the database guarantees that only one will succeed (returns `changes = 1`). Prevents duplicate advances without requiring complex distributed locks (like Redis).

### 4. Immutable Audit Log
**Decision:** The `payout_transactions` table is strictly append-only.
- **Implementation:** Never `UPDATE` or `DELETE` rows. All balance changes are recorded as new rows (credits or debits).
- **Benefit:** Creates an unbreakable audit trail, enabling balance reconstruction and financial compliance.

## Error & Edge Case Handling
- **Concurrent Requests:** Mitigated via atomic DB transactions and check-and-set logic.
- **24-hour Withdrawal Rule:** Strictly enforced in the service layer against `last_withdrawal_at`.
- **Negative Balances:** Tracked via `adjustment_balance` and correctly deducted from `withdrawable_balance`.
- **Failed Payouts:** Fully automated recovery; refunds user balance and allows them to retry.
