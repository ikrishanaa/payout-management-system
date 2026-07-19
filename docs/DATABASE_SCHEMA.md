# Database Schema - Payout Management System

## Entity-Relationship Diagram

```
┌──────────┐     ┌──────────┐     ┌───────────────┐
│  users   │────<│  sales   │>────│    brands     │
│          │     │          │     │               │
│ id (PK)  │     │ id (PK)  │     │ id (PK)      │
│ name     │     │ user_id  │     │ name          │
│ email    │     │ brand_id │     └───────────────┘
└────┬─────┘     │ status   │
     │           │ earning  │
     │           │ advance_ │
     │           │   paid   │
     │           │ advance_ │
     │           │   amount │
     │           └──────────┘
     │
     ├──────<┌───────────────┐
     │       │ user_balances │
     │       │               │
     │       │ user_id (PK)  │
     │       │ withdrawable  │
     │       │ total_earned  │
     │       │ total_advance │
     │       │ adjustment    │
     │       │ last_withdraw │
     │       └───────────────┘
     │
     ├──────<┌───────────────┐
     │       │   payouts     │
     │       │               │
     │       │ id (PK)       │
     │       │ user_id       │
     │       │ amount        │
     │       │ status        │
     │       │ failure_reason│
     │       └───────────────┘
     │
     └──────<┌────────────────────┐
             │ payout_transactions│
             │                    │
             │ id (PK)            │
             │ user_id            │
             │ type               │
             │ amount             │
             │ reference_id       │
             │ description        │
             └────────────────────┘
```

## Table Definitions

### 1. `users`
Stores user profile information.
- `id` (TEXT): Primary Key.
- `name` (TEXT): User's full name.
- `email` (TEXT): User's email address.
- `created_at` (DATETIME): Record creation timestamp.

### 2. `brands`
Stores affiliate brand information.
- `id` (TEXT): Primary Key.
- `name` (TEXT): Name of the brand (e.g., "Brand X").
- `created_at` (DATETIME): Record creation timestamp.

### 3. `sales`
Records individual sales made by users for specific brands.
- `id` (TEXT): Primary Key.
- `user_id` (TEXT): Foreign Key referencing `users(id)`.
- `brand_id` (TEXT): Foreign Key referencing `brands(id)`.
- `earning` (REAL): The total earning amount for this sale.
- `status` (TEXT): The current state of the sale. Allowed values: `pending`, `approved`, `rejected`. Defaults to `pending`.
- `advance_paid` (INTEGER): Boolean flag (0 or 1). 1 means the 10% advance has been disbursed. Defaults to 0.
- `advance_amount` (REAL): The calculated 10% advance amount paid for this sale. Defaults to 0.
- `created_at` (DATETIME): Record creation timestamp.
- `updated_at` (DATETIME): Record update timestamp.

### 4. `user_balances`
A materialized view caching computed financial states for O(1) retrieval and rapid withdrawal checks.
- `user_id` (TEXT): Primary Key, referencing `users(id)`.
- `withdrawable_balance` (REAL): Total funds available for the user to withdraw.
- `total_earned` (REAL): All-time total approved earnings.
- `total_advance_paid` (REAL): All-time total advance payouts received.
- `adjustment_balance` (REAL): Total clawbacks resulting from rejected sales after an advance was paid.
- `last_withdrawal_at` (DATETIME): Timestamp of the user's most recent withdrawal. Used to enforce the 24-hour rule.
- `updated_at` (DATETIME): Record update timestamp.

### 5. `payouts`
Logs user withdrawal requests.
- `id` (TEXT): Primary Key.
- `user_id` (TEXT): Foreign Key referencing `users(id)`.
- `amount` (REAL): Requested withdrawal amount.
- `status` (TEXT): State of the payout. Allowed values: `processing`, `completed`, `failed`. Defaults to `processing`.
- `failure_reason` (TEXT): Descriptive text if the payout failed.
- `created_at` (DATETIME): Record creation timestamp.
- `updated_at` (DATETIME): Record update timestamp.

### 6. `payout_transactions`
An immutable, append-only ledger recording every change to a user's financial balance.
- `id` (TEXT): Primary Key.
- `user_id` (TEXT): Foreign Key referencing `users(id)`.
- `type` (TEXT): The type of transaction. Values: `advance_payout`, `reconciliation_credit`, `reconciliation_debit`, `withdrawal`, `withdrawal_reversal`.
- `amount` (REAL): Financial amount. Positive values indicate a credit; negative values indicate a debit.
- `reference_id` (TEXT): Contextual identifier (e.g., Sale ID or Payout ID).
- `description` (TEXT): Human-readable note about the transaction.
- `created_at` (DATETIME): Record creation timestamp.

### 7. `reconciliation_logs`
An audit trail for batch reconciliation runs.
- `id` (TEXT): Primary Key.
- `batch_id` (TEXT): Identifier for the batch run.
- `sales_processed` (INTEGER): Number of sales included in this batch.
- `total_credits` (REAL): Total value of approved earnings credited.
- `total_debits` (REAL): Total value of clawbacks debited.
- `created_at` (DATETIME): Record creation timestamp.

## Indexes

To optimize query performance, the following indexes are applied:

```sql
CREATE INDEX idx_sales_user_status ON sales(user_id, status);
CREATE INDEX idx_sales_status ON sales(status);
CREATE INDEX idx_sales_advance_paid ON sales(user_id, advance_paid, status);

CREATE INDEX idx_payouts_user ON payouts(user_id, status);
CREATE INDEX idx_payouts_status ON payouts(status);

CREATE INDEX idx_transactions_user ON payout_transactions(user_id);
CREATE INDEX idx_transactions_type ON payout_transactions(type);
CREATE INDEX idx_transactions_ref ON payout_transactions(reference_id);
```
