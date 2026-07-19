# API Documentation - Payout Management System

Base URL: `http://localhost:3000`

---

## 1. Sales API

Endpoints for managing affiliate sales records.

### `POST /api/sales`
Creates a new pending sale record for a user.
- **Request Body:**
  ```json
  {
    "userId": "string (required)",
    "brandId": "string (required)",
    "earning": "number (required)"
  }
  ```
- **Response (201):** Returns the created sale object.

### `GET /api/sales`
Lists all sales. Supports filtering via query parameters.
- **Query Parameters:**
  - `status` (optional): Filter by status (`pending`, `approved`, `rejected`).
  - `userId` (optional): Filter by specific user ID.
  - `brandId` (optional): Filter by specific brand ID.
- **Response (200):** Array of sale objects.

### `GET /api/sales/:id`
Retrieves a specific sale by its ID.
- **Response (200):** Sale object.

### `GET /api/sales/user/:userId`
Retrieves all sales belonging to a specific user, along with a summary of total earnings and statuses.
- **Query Parameters:**
  - `status` (optional): Filter by status.
- **Response (200):** 
  ```json
  {
    "userId": "string",
    "summary": {
      "totalSales": "number",
      "totalEarnings": "number",
      "pendingEarnings": "number",
      "approvedEarnings": "number",
      "rejectedEarnings": "number"
    },
    "sales": [...]
  }
  ```

---

## 2. Advance Payouts API

Endpoints for managing the 10% advance payout logic.

### `POST /api/advance/process`
Global job endpoint to process 10% advance payouts for all users who have eligible pending sales. **Idempotent.**
- **Response (200):**
  ```json
  {
    "message": "Advance payout processing completed",
    "processedCount": "number",
    "totalAmountDisbursed": "number"
  }
  ```

### `POST /api/advance/process/:userId`
Targeted endpoint to process 10% advance payouts for a specific user.
- **Response (200):** Details of the advance payout applied to the user.

---

## 3. Reconciliation API

Endpoints for admins/system to approve or reject sales.

### `POST /api/reconciliation/sale`
Reconciles a single sale.
- **Request Body:**
  ```json
  {
    "saleId": "string (required)",
    "status": "string ('approved' or 'rejected') (required)"
  }
  ```
- **Response (200):** Details of the reconciliation process, including clawbacks (if rejected) or final credits (if approved).

### `POST /api/reconciliation/batch`
Batch processes multiple reconciliations at once.
- **Request Body:**
  ```json
  {
    "reconciliations": [
      {
        "saleId": "string",
        "status": "string ('approved' or 'rejected')"
      }
    ]
  }
  ```
- **Response (200):** Batch execution summary.

### `GET /api/reconciliation/summary/:userId`
Retrieves a reconciliation breakdown for a user.
- **Response (200):** Summary statistics of the user's reconciled vs. pending sales.

---

## 4. Withdrawals / Payouts API

Endpoints for user withdrawal requests.

### `POST /api/payouts/withdraw`
Initiates a user withdrawal. Enforces 24-hour limit and sufficient balance checks.
- **Request Body:**
  ```json
  {
    "userId": "string (required)",
    "amount": "number (required, > 0)"
  }
  ```
- **Response (201):** The newly created payout record (status: `processing`).

### `POST /api/payouts/:id/fail`
Webhook/internal endpoint to mark a payout as failed, triggering an automatic balance refund.
- **Request Body:**
  ```json
  {
    "status": "failed",
    "reason": "string (optional)"
  }
  ```
- **Response (200):** Updated payout record and recovery confirmation.

### `POST /api/payouts/:id/complete`
Webhook/internal endpoint to mark a payout as successfully disbursed by the bank.
- **Response (200):** Updated payout record.

### `GET /api/payouts/user/:userId`
Retrieves a history of a user's withdrawal requests.
- **Response (200):** Array of payout records.

### `GET /api/payouts/:id`
Retrieves the details of a specific payout request.
- **Response (200):** Payout object.

---

## 5. Balance & Transactions API

Endpoints to retrieve current financial states and audit ledgers.

### `GET /api/balance/:userId`
Gets the materialized (cached) balance for a user.
- **Response (200):**
  ```json
  {
    "userId": "string",
    "withdrawableBalance": "number",
    "totalEarned": "number",
    "totalAdvancePaid": "number",
    "adjustmentBalance": "number",
    "lastWithdrawalAt": "date | null",
    "canWithdraw": "boolean",
    "nextAllowedWithdrawal": "date | null"
  }
  ```

### `GET /api/balance/:userId/transactions`
Retrieves the immutable audit log of all financial transactions for a user.
- **Response (200):** Array of `payout_transactions` records, sorted by date (newest first).

### `GET /api/balance/:userId/verify`
Calculates the user's balance dynamically from the transaction ledger and compares it against the materialized balance to guarantee financial consistency.
- **Response (200):**
  ```json
  {
    "userId": "string",
    "isConsistent": "boolean",
    "materializedBalance": "number",
    "calculatedBalance": "number",
    "auditDetails": {...}
  }
  ```
