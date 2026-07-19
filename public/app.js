/**
 * PayoutHQ — Frontend Application
 * 
 * Interacts with the Payout Management System REST API.
 */

const API = '';

// ─── STATE ───
let currentUser = 'aarav_sharma';
let currentTab = 'overview';

// ─── UTILITIES ───

async function api(path, options = {}) {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    if (err.message === 'Failed to fetch') {
      setServerStatus(false);
      throw new Error('Server unreachable. Is it running?');
    }
    throw err;
  }
}

function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function formatCurrency(amount) {
  return `₹${Number(amount || 0).toFixed(2)}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortId(id) {
  return id ? id.substring(0, 8) + '…' : '—';
}

function badgeHtml(text) {
  const cls = text.toLowerCase().replace(/\s/g, '_');
  return `<span class="badge badge-${cls}">${text}</span>`;
}

function setServerStatus(online) {
  const el = document.getElementById('serverStatus');
  if (online) {
    el.className = 'status-badge online';
    el.textContent = '● Connected';
  } else {
    el.className = 'status-badge offline';
    el.textContent = '● Disconnected';
  }
}

// ─── NAVIGATION ───

const tabMeta = {
  overview: { title: 'Overview', subtitle: 'System-wide dashboard' },
  sales: { title: 'Sales', subtitle: 'View and create affiliate sales' },
  advance: { title: 'Advance Payout', subtitle: 'Process 10% advance payouts' },
  reconciliation: { title: 'Reconciliation', subtitle: 'Approve or reject pending sales' },
  withdrawals: { title: 'Withdrawals', subtitle: 'Withdraw earnings and manage payouts' },
  transactions: { title: 'Audit Log', subtitle: 'Immutable transaction ledger' },
};

function switchTab(tab) {
  currentTab = tab;

  // Update nav
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Update content
  document.querySelectorAll('.tab-content').forEach(section => {
    section.classList.toggle('active', section.id === `tab-${tab}`);
  });

  // Update header
  const meta = tabMeta[tab];
  document.getElementById('pageTitle').textContent = meta.title;
  document.getElementById('pageSubtitle').textContent = meta.subtitle;

  // Load data for the tab
  loadTabData(tab);
}

function loadTabData(tab) {
  switch (tab) {
    case 'overview': loadOverview(); break;
    case 'sales': loadSales(); break;
    case 'advance': break; // Static page, no auto-load
    case 'reconciliation': loadReconciliation(); break;
    case 'withdrawals': loadWithdrawals(); break;
    case 'transactions': loadTransactions(); break;
  }
}

// ─── OVERVIEW ───

async function loadOverview() {
  try {
    const balanceRes = await api(`/api/balance/${currentUser}`);
    const b = balanceRes.data;

    document.getElementById('statBalance').textContent = formatCurrency(b.withdrawable_balance);
    document.getElementById('statEarned').textContent = formatCurrency(b.total_earned);
    document.getElementById('statAdvance').textContent = formatCurrency(b.total_advance_paid);
    document.getElementById('statAdjustment').textContent = formatCurrency(b.adjustment_balance);

    // Withdrawal status
    const statusEl = document.getElementById('withdrawalStatusInfo');
    if (b.canWithdraw) {
      statusEl.innerHTML = `<span style="color:var(--accent-green)">✓ Withdrawals available.</span> Balance: <strong>${formatCurrency(b.withdrawable_balance)}</strong>`;
    } else {
      statusEl.innerHTML = `<span style="color:var(--accent-red)">⏳ Locked for ${b.hoursUntilWithdrawal}h.</span> Next withdrawal: <strong>${formatDate(b.nextWithdrawalAt)}</strong>`;
    }

    setServerStatus(true);
  } catch (err) {
    toast(err.message, 'error');
  }

  // Sales breakdown
  try {
    const salesRes = await api(`/api/sales?userId=${currentUser}`);
    const sales = salesRes.data;
    const counts = { pending: 0, approved: 0, rejected: 0 };
    sales.forEach(s => { if (counts[s.status] !== undefined) counts[s.status]++; });

    document.getElementById('salesBreakdown').innerHTML = `
      <div class="breakdown-item breakdown-pending">
        <div class="count">${counts.pending}</div>
        <div class="label">Pending</div>
      </div>
      <div class="breakdown-item breakdown-approved">
        <div class="count">${counts.approved}</div>
        <div class="label">Approved</div>
      </div>
      <div class="breakdown-item breakdown-rejected">
        <div class="count">${counts.rejected}</div>
        <div class="label">Rejected</div>
      </div>
    `;
  } catch (err) { /* already handled */ }

  // Recent transactions
  try {
    const txRes = await api(`/api/balance/${currentUser}/transactions`);
    const tbody = document.querySelector('#recentTransactions tbody');
    const txns = (txRes.data || []).slice(0, 5);
    if (txns.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No transactions yet</td></tr>';
    } else {
      tbody.innerHTML = txns.map(tx => `
        <tr>
          <td>${badgeHtml(tx.type)}</td>
          <td><strong>${formatCurrency(tx.amount)}</strong></td>
          <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis">${tx.description}</td>
          <td style="white-space:nowrap">${formatDate(tx.created_at)}</td>
        </tr>
      `).join('');
    }
  } catch (err) { /* already handled */ }
}

// ─── SALES ───

async function loadSales() {
  try {
    const status = document.getElementById('salesStatusFilter').value;
    let url = `/api/sales?userId=${currentUser}`;
    if (status) url += `&status=${status}`;

    const res = await api(url);
    const tbody = document.querySelector('#salesTable tbody');

    if (!res.data || res.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No sales found</td></tr>';
      return;
    }

    tbody.innerHTML = res.data.map(s => `
      <tr>
        <td class="id-cell" title="${s.id}">${shortId(s.id)}</td>
        <td>${s.brand_id}</td>
        <td><strong>${formatCurrency(s.earning)}</strong></td>
        <td>${badgeHtml(s.status)}</td>
        <td>${s.advance_paid ? `${formatCurrency(s.advance_amount)}` : '—'}</td>
        <td style="white-space:nowrap">${formatDate(s.created_at)}</td>
      </tr>
    `).join('');

    setServerStatus(true);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function createSale(e) {
  e.preventDefault();
  const brand = document.getElementById('saleBrand').value;
  const earning = parseFloat(document.getElementById('saleEarning').value);

  if (!earning || earning <= 0) {
    toast('Enter a valid earning amount', 'error');
    return;
  }

  try {
    await api('/api/sales', {
      method: 'POST',
      body: JSON.stringify({ userId: currentUser, brandId: brand, earning }),
    });
    toast(`Sale created: ${formatCurrency(earning)} for ${currentUser}`, 'success');
    document.getElementById('saleEarning').value = '';
    loadSales();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── ADVANCE PAYOUT ───

async function processAdvance(allUsers = true) {
  const resultEl = document.getElementById('advanceResult');
  try {
    const url = allUsers ? '/api/advance/process' : `/api/advance/process/${currentUser}`;
    const res = await api(url, { method: 'POST' });
    const d = res.data;

    resultEl.style.display = 'block';
    resultEl.className = 'result-box success';
    resultEl.innerHTML = `
      <strong>✓ Advance payouts processed</strong><br>
      Sales processed: <strong>${d.processed}</strong><br>
      Skipped (already paid): <strong>${d.skipped}</strong><br>
      Total advanced: <strong>${formatCurrency(d.totalAdvanced)}</strong>
    `;
    toast(d.message, 'success');
  } catch (err) {
    resultEl.style.display = 'block';
    resultEl.className = 'result-box error';
    resultEl.textContent = `Error: ${err.message}`;
    toast(err.message, 'error');
  }
}

// ─── RECONCILIATION ───

async function loadReconciliation() {
  try {
    const res = await api(`/api/sales?userId=${currentUser}&status=pending`);
    const tbody = document.querySelector('#reconcileTable tbody');
    const sales = (res.data || []).filter(s => s.advance_paid);

    if (sales.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No eligible sales for reconciliation (run advance payout first)</td></tr>';
      document.getElementById('reconcileActions').style.display = 'none';
      return;
    }

    tbody.innerHTML = sales.map(s => `
      <tr>
        <td><input type="checkbox" class="reconcile-check" data-sale-id="${s.id}"></td>
        <td class="id-cell" title="${s.id}">${shortId(s.id)}</td>
        <td>${s.brand_id}</td>
        <td><strong>${formatCurrency(s.earning)}</strong></td>
        <td>${formatCurrency(s.advance_amount)}</td>
        <td>
          <button class="btn btn-success btn-sm" onclick="reconcileSingle('${s.id}', 'approved')">✓ Approve</button>
          <button class="btn btn-danger btn-sm" onclick="reconcileSingle('${s.id}', 'rejected')">✗ Reject</button>
        </td>
      </tr>
    `).join('');

    document.getElementById('reconcileActions').style.display = 'flex';
    updateSelectAll();
  } catch (err) {
    toast(err.message, 'error');
  }

  // Load summary
  try {
    const summaryRes = await api(`/api/reconciliation/summary/${currentUser}`);
    const d = summaryRes.data;
    
    let approved = 0, rejected = 0, pending = 0, totalEarnings = 0;
    if (d && d.salesSummary) {
      d.salesSummary.forEach(s => {
        if (s.status === 'approved') approved = s.count;
        if (s.status === 'rejected') rejected = s.count;
        if (s.status === 'pending') pending = s.count;
        totalEarnings += (s.total_earnings || 0);
      });
    }

    document.getElementById('reconcileSummary').innerHTML = `
      <div class="sales-breakdown">
        <div class="breakdown-item breakdown-approved">
          <div class="count">${approved}</div>
          <div class="label">Approved</div>
        </div>
        <div class="breakdown-item breakdown-rejected">
          <div class="count">${rejected}</div>
          <div class="label">Rejected</div>
        </div>
        <div class="breakdown-item breakdown-pending">
          <div class="count">${pending}</div>
          <div class="label">Pending</div>
        </div>
        <div class="breakdown-item" style="background:var(--accent-blue-glow)">
          <div class="count" style="color:var(--accent-blue)">${formatCurrency(totalEarnings)}</div>
          <div class="label">Total Earnings</div>
        </div>
      </div>
    `;
  } catch (err) { /* ignore */ }
}

async function reconcileSingle(saleId, status) {
  try {
    await api('/api/reconciliation/sale', {
      method: 'POST',
      body: JSON.stringify({ saleId, status }),
    });
    toast(`Sale ${shortId(saleId)} ${status}`, status === 'approved' ? 'success' : 'info');
    loadReconciliation();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function reconcileBatch(status) {
  const checked = document.querySelectorAll('.reconcile-check:checked');
  if (checked.length === 0) {
    toast('Select at least one sale', 'error');
    return;
  }

  const reconciliations = Array.from(checked).map(cb => ({
    saleId: cb.dataset.saleId,
    status,
  }));

  const resultEl = document.getElementById('reconcileResult');
  try {
    const res = await api('/api/reconciliation/batch', {
      method: 'POST',
      body: JSON.stringify({ reconciliations }),
    });
    const d = res.data;

    resultEl.style.display = 'block';
    resultEl.className = 'result-box success';
    resultEl.innerHTML = `
      <strong>✓ Batch reconciliation complete</strong><br>
      Processed: ${d.successful}/${d.total} | 
      Credits: <strong>${formatCurrency(d.totalCredits)}</strong> | 
      Debits: <strong>${formatCurrency(d.totalDebits)}</strong> | 
      Net: <strong>${formatCurrency(d.netPayout)}</strong>
    `;
    toast(`Batch ${status}: ${d.successful} sales`, 'success');
    loadReconciliation();
  } catch (err) {
    resultEl.style.display = 'block';
    resultEl.className = 'result-box error';
    resultEl.textContent = err.message;
    toast(err.message, 'error');
  }
}

function updateSelectAll() {
  const selectAll = document.getElementById('selectAllReconcile');
  selectAll.onchange = () => {
    document.querySelectorAll('.reconcile-check').forEach(cb => {
      cb.checked = selectAll.checked;
    });
  };
}

// ─── WITHDRAWALS ───

async function loadWithdrawals() {
  // Balance info
  try {
    const balRes = await api(`/api/balance/${currentUser}`);
    const b = balRes.data;
    const infoEl = document.getElementById('withdrawalInfo');

    let statusText = '';
    if (b.canWithdraw) {
      statusText = `<span style="color:var(--accent-green)">✓ Withdrawals enabled</span>`;
    } else {
      statusText = `<span style="color:var(--accent-red)">⏳ Locked — next withdrawal in ${b.hoursUntilWithdrawal}h</span>`;
    }

    infoEl.innerHTML = `
      Available: <strong>${formatCurrency(b.withdrawable_balance)}</strong> &nbsp;|&nbsp; ${statusText}
    `;

    document.getElementById('withdrawBtn').disabled = !b.canWithdraw;
  } catch (err) {
    toast(err.message, 'error');
  }

  // Payout history
  try {
    const payRes = await api(`/api/payouts/user/${currentUser}`);
    const tbody = document.querySelector('#payoutsTable tbody');
    const payouts = payRes.data || [];

    if (payouts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No payouts yet</td></tr>';
      return;
    }

    tbody.innerHTML = payouts.map(p => `
      <tr>
        <td class="id-cell" title="${p.id}">${shortId(p.id)}</td>
        <td><strong>${formatCurrency(p.amount)}</strong></td>
        <td>${badgeHtml(p.status)}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${p.failure_reason || '—'}</td>
        <td style="white-space:nowrap">${formatDate(p.created_at)}</td>
        <td>
          ${p.status === 'pending' ? `
            <button class="btn btn-success btn-sm" onclick="updatePayout('${p.id}', 'complete')">✓ Complete</button>
            <button class="btn btn-danger btn-sm" onclick="updatePayout('${p.id}', 'fail')">✗ Fail</button>
          ` : '—'}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function withdraw(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('withdrawAmount').value);
  if (!amount || amount <= 0) {
    toast('Enter a valid amount', 'error');
    return;
  }

  const resultEl = document.getElementById('withdrawResult');
  try {
    const res = await api('/api/payouts/withdraw', {
      method: 'POST',
      body: JSON.stringify({ userId: currentUser, amount }),
    });

    resultEl.style.display = 'block';
    resultEl.className = 'result-box success';
    resultEl.innerHTML = `
      <strong>✓ Withdrawal initiated</strong><br>
      Amount: <strong>${formatCurrency(res.data.payout.amount)}</strong><br>
      Payout ID: <code>${shortId(res.data.payout.id)}</code><br>
      Remaining: <strong>${formatCurrency(res.data.remainingBalance)}</strong>
    `;
    toast(`Withdrew ${formatCurrency(amount)}`, 'success');
    document.getElementById('withdrawAmount').value = '';
    loadWithdrawals();
  } catch (err) {
    resultEl.style.display = 'block';
    resultEl.className = 'result-box error';
    resultEl.textContent = `Error: ${err.message}`;
    toast(err.message, 'error');
  }
}

async function updatePayout(payoutId, action) {
  try {
    const url = `/api/payouts/${payoutId}/${action}`;
    const body = action === 'fail' ? { status: 'failed', reason: 'Simulated failure' } : {};
    const res = await api(url, { method: 'POST', body: JSON.stringify(body) });

    if (action === 'fail') {
      toast(`Payout failed — ${formatCurrency(res.data.restoredAmount)} credited back`, 'info');
    } else {
      toast('Payout completed', 'success');
    }
    loadWithdrawals();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── TRANSACTIONS ───

async function loadTransactions() {
  try {
    const res = await api(`/api/balance/${currentUser}/transactions`);
    const tbody = document.querySelector('#transactionsTable tbody');
    const txns = res.data || [];

    if (txns.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No transactions yet</td></tr>';
      return;
    }

    tbody.innerHTML = txns.map(tx => `
      <tr>
        <td>${badgeHtml(tx.type)}</td>
        <td><strong>${formatCurrency(tx.amount)}</strong></td>
        <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${tx.description}</td>
        <td class="id-cell" title="${tx.reference_id}">${shortId(tx.reference_id)}</td>
        <td style="white-space:nowrap">${formatDate(tx.created_at)}</td>
      </tr>
    `).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function verifyBalance() {
  const resultEl = document.getElementById('verifyResult');
  try {
    const res = await api(`/api/balance/${currentUser}/verify`);
    const d = res.data;

    resultEl.style.display = 'block';
    if (d.is_consistent) {
      resultEl.className = 'result-box success';
      resultEl.innerHTML = `
        <strong>✓ Balance is consistent!</strong><br>
        Materialized: <strong>${formatCurrency(d.materialized_balance)}</strong><br>
        Computed from log: <strong>${formatCurrency(d.computed_from_log)}</strong><br>
        Total credits: ${formatCurrency(d.total_credits)} | Total debits: ${formatCurrency(d.total_debits)}<br>
        Drift: <strong>${d.drift}</strong>
      `;
    } else {
      resultEl.className = 'result-box error';
      resultEl.innerHTML = `
        <strong>⚠ Balance drift detected!</strong><br>
        Materialized: ${formatCurrency(d.materialized_balance)} vs Computed: ${formatCurrency(d.computed_from_log)}<br>
        Drift: <strong>${d.drift}</strong>
      `;
    }
  } catch (err) {
    resultEl.style.display = 'block';
    resultEl.className = 'result-box error';
    resultEl.textContent = err.message;
  }
}

// ─── EVENT LISTENERS ───

document.addEventListener('DOMContentLoaded', () => {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // User selector
  document.getElementById('userSelect').addEventListener('change', (e) => {
    currentUser = e.target.value;
    toast(`Switched to ${currentUser}`, 'info');
    loadTabData(currentTab);
  });

  // Sales
  document.getElementById('createSaleForm').addEventListener('submit', createSale);
  document.getElementById('refreshSalesBtn').addEventListener('click', loadSales);
  document.getElementById('salesStatusFilter').addEventListener('change', loadSales);

  // Advance
  document.getElementById('processAdvanceAllBtn').addEventListener('click', () => processAdvance(true));
  document.getElementById('processAdvanceUserBtn').addEventListener('click', () => processAdvance(false));

  // Reconciliation
  document.getElementById('refreshReconcileBtn').addEventListener('click', loadReconciliation);
  document.getElementById('batchApproveBtn').addEventListener('click', () => reconcileBatch('approved'));
  document.getElementById('batchRejectBtn').addEventListener('click', () => reconcileBatch('rejected'));

  // Withdrawals
  document.getElementById('withdrawForm').addEventListener('submit', withdraw);
  document.getElementById('refreshPayoutsBtn').addEventListener('click', loadWithdrawals);

  // Transactions
  document.getElementById('refreshTransactionsBtn').addEventListener('click', loadTransactions);
  document.getElementById('verifyBalanceBtn').addEventListener('click', verifyBalance);

  // Load initial data
  loadOverview();
});
