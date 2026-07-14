/**
 * client/src/app.ts
 *
 * Main client application. No framework — plain DOM, a small central
 * state object, and explicit render functions. Two entry points into any
 * action: the bento buttons, and the free-text prompt bar — both converge
 * on the same preview -> confirm -> wallet-intent flow.
 */

import {
  connectWallet,
  disconnectWallet,
  onWalletChange,
  getWalletState,
  getBalance,
  resolvePeer,
  sendTokens,
  sendDM,
  describeIntentError,
  createInvoice,
  getInvoices,
  payInvoice,
  cancelInvoice,
  getAllReceipts,
  type Asset,
  type IncomingReceipt,
} from './wallet';
import { getRecentListings, type MarketIntent } from './market';
import { formatBalance, toSmallestUnits } from './format';
import { identiconSvg } from './identicon';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let balance: Asset[] | null = null;
let balanceLoading = false;
let recentListings: MarketIntent[] | null = null;
let receiptsCache: IncomingReceipt[] | null = null;
let sentInvoicesCache: any[] | null = null;

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id} in the page`);
  return found as T;
};

// ---------------------------------------------------------------------------
// Header / wallet connection
// ---------------------------------------------------------------------------

function renderWalletHeader() {
  const state = getWalletState();
  const container = el('wallet-status');

  if (state.status === 'connected' && state.identity) {
    const label = state.identity.nametag ? `@${state.identity.nametag}` : shortAddr(state.identity.chainPubkey);
    container.innerHTML = `
      <div class="wallet-pill">
        <span class="identicon">${identiconSvg(state.identity.chainPubkey, 28)}</span>
        <span class="wallet-label">${label}</span>
        <button class="btn-ghost" id="btn-disconnect">Disconnect</button>
      </div>
    `;
    el('btn-disconnect').addEventListener('click', () => disconnectWallet());
  } else if (state.status === 'connecting') {
    container.innerHTML = `<button class="btn-primary" disabled>Connecting…</button>`;
  } else {
    container.innerHTML = `
      <button class="btn-primary" id="btn-connect">Connect wallet</button>
      ${state.error ? `<div class="error-text">${escapeHtml(state.error)}</div>` : ''}
    `;
    el('btn-connect').addEventListener('click', () => connectWallet());
  }
}

function shortAddr(addr: string): string {
  if (!addr) return 'Unknown';
  return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Balance card
// ---------------------------------------------------------------------------

async function refreshBalance() {
  const state = getWalletState();
  if (state.status !== 'connected') {
    balance = null;
    renderBalanceCard();
    return;
  }
  balanceLoading = true;
  renderBalanceCard();
  try {
    balance = await getBalance();
  } catch (err: any) {
    balance = [];
    console.warn('Could not load balance:', err?.message || err);
  } finally {
    balanceLoading = false;
    renderBalanceCard();
  }
}

function renderBalanceCard() {
  const container = el('card-balance-body');
  const state = getWalletState();

  if (state.status !== 'connected') {
    container.innerHTML = `<p class="empty-state">Connect your wallet to see your real holdings.</p>`;
    return;
  }
  if (balanceLoading) {
    container.innerHTML = `<p class="empty-state">Loading balance…</p>`;
    return;
  }
  if (!balance || balance.length === 0) {
    container.innerHTML = `<p class="empty-state">No tokens in this wallet yet.</p>`;
    return;
  }
  container.innerHTML = `
    <ul class="asset-list">
      ${balance
        .map(
          (a) => `
        <li class="asset-row">
          <span class="asset-symbol">${escapeHtml(a.symbol)}</span>
          <span class="asset-amount">${escapeHtml(formatBalance(a.totalAmount, a.decimals, ''))}</span>
        </li>`
        )
        .join('')}
    </ul>
  `;
}

// ---------------------------------------------------------------------------
// Recent market activity card
// ---------------------------------------------------------------------------

async function refreshRecentListings() {
  const container = el('card-activity-body');
  container.innerHTML = `<p class="empty-state">Loading recent activity…</p>`;
  try {
    recentListings = await getRecentListings();
  } catch (err: any) {
    recentListings = [];
    console.warn('Could not load recent listings:', err?.message || err);
  }
  renderActivityCard();
}

function renderActivityCard() {
  const container = el('card-activity-body');
  if (!recentListings || recentListings.length === 0) {
    container.innerHTML = `<p class="empty-state">Nothing posted on the market recently.</p>`;
    return;
  }
  container.innerHTML = `
    <ul class="listing-list">
      ${recentListings
        .slice(0, 8)
        .map(
          (it) => `
        <li class="listing-row">
          <span class="listing-desc">${escapeHtml(it.description)}</span>
          <span class="listing-meta">${it.price ? `${it.price} ${escapeHtml(it.currency)}` : ''}</span>
        </li>`
        )
        .join('')}
    </ul>
  `;
}

// ---------------------------------------------------------------------------
// Modal plumbing
// ---------------------------------------------------------------------------

function openModal(title: string, bodyHtml: string): HTMLElement {
  const root = el('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
          <button class="btn-ghost" id="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    </div>
  `;
  root.classList.add('open');
  el('modal-close').addEventListener('click', closeModal);
  el('modal-backdrop').addEventListener('click', (e) => {
    if (e.target === el('modal-backdrop')) closeModal();
  });
  return root.querySelector('.modal-body') as HTMLElement;
}

function closeModal() {
  const root = el('modal-root');
  root.classList.remove('open');
  root.innerHTML = '';
}

// ---------------------------------------------------------------------------
// Send flow
// ---------------------------------------------------------------------------

interface SendPrefill {
  to?: string | null;
  amount?: string | null;
  token?: string | null;
}

function openSendModal(prefill: SendPrefill = {}) {
  const state = getWalletState();
  if (state.status !== 'connected') {
    openModal('Connect your wallet', `<p class="empty-state">Connect your wallet first — sending needs your wallet's approval.</p>`);
    return;
  }

  const assets = balance || [];
  const body = openModal(
    'Send tokens',
    `
    <form id="send-form" class="stack">
      <label>Token
        <select name="coinId" required>
          <option value="" disabled ${!prefill.token ? 'selected' : ''}>Choose a token</option>
          ${assets
            .map(
              (a) =>
                `<option value="${a.coinId}" data-decimals="${a.decimals}" data-symbol="${a.symbol}" ${
                  prefill.token && prefill.token.toUpperCase() === a.symbol.toUpperCase() ? 'selected' : ''
                }>${escapeHtml(a.symbol)} — ${formatBalance(a.totalAmount, a.decimals, '')} available</option>`
            )
            .join('')}
        </select>
      </label>
      <label>Amount
        <input name="amount" type="text" inputmode="decimal" placeholder="0.00" value="${prefill.amount ? escapeHtml(prefill.amount) : ''}" required />
      </label>
      <label>Send to
        <input name="to" type="text" placeholder="@nametag or address" value="${prefill.to ? escapeHtml(prefill.to) : ''}" required />
      </label>
      <div class="form-error" id="send-form-error"></div>
      <button type="submit" class="btn-primary">Preview</button>
    </form>
  `
  );

  body.querySelector('#send-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const coinId = String(data.get('coinId') || '');
    const amount = String(data.get('amount') || '').trim();
    const to = String(data.get('to') || '').trim();
    const errorEl = body.querySelector('#send-form-error')!;

    if (!coinId) {
      errorEl.textContent = 'Choose which token to send.';
      return;
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      errorEl.textContent = 'Enter an amount greater than zero.';
      return;
    }
    if (!to) {
      errorEl.textContent = 'Enter who to send to.';
      return;
    }

    const asset = assets.find((a) => a.coinId === coinId);
    errorEl.textContent = '';
    openSendPreview({ to, amount, coinId, symbol: asset?.symbol || '', decimals: asset?.decimals ?? 0 });
  });
}

async function openSendPreview(args: { to: string; amount: string; coinId: string; symbol: string; decimals: number }) {
  const body = openModal('Confirm send', `<p class="empty-state">Resolving recipient…</p>`);
  const resolved = await resolvePeer(args.to).catch(() => null);
  const resolvedLabel = resolved?.nametag ? `@${resolved.nametag}` : resolved?.directAddress || args.to;

  body.innerHTML = `
    <div class="preview">
      <div class="preview-row"><span>Sending</span><strong>${escapeHtml(args.amount)} ${escapeHtml(args.symbol)}</strong></div>
      <div class="preview-row"><span>To</span><strong>${escapeHtml(resolvedLabel)}</strong></div>
      ${!resolved ? `<p class="form-error">Could not resolve this recipient yet — double check it before continuing.</p>` : ''}
    </div>
    <div class="modal-actions">
      <button class="btn-ghost" id="send-cancel">Cancel</button>
      <button class="btn-primary" id="send-confirm">Confirm &amp; send</button>
    </div>
  `;

  body.querySelector('#send-cancel')!.addEventListener('click', closeModal);
  body.querySelector('#send-confirm')!.addEventListener('click', async () => {
    body.innerHTML = `<p class="empty-state">Check your wallet to approve this send…</p>`;
    try {
      const smallest = toSmallestUnits(args.amount, args.decimals);
      const result = await sendTokens({ to: args.to, amount: smallest, coinId: args.coinId });
      body.innerHTML = `
        <div class="preview">
          <p class="success-text">Sent. Transfer ID: ${escapeHtml(result.id || 'pending')}</p>
        </div>
        <div class="modal-actions"><button class="btn-primary" id="send-done">Done</button></div>
      `;
      body.querySelector('#send-done')!.addEventListener('click', closeModal);
      refreshBalance();
    } catch (err: any) {
      body.innerHTML = `
        <p class="form-error">${escapeHtml(describeIntentError(err))}</p>
        <div class="modal-actions"><button class="btn-ghost" id="send-close">Close</button></div>
      `;
      body.querySelector('#send-close')!.addEventListener('click', closeModal);
    }
  });
}

// ---------------------------------------------------------------------------
// Invoices — a standardized, cross-wallet "request payment with terms"
// primitive. Confirmed real (sphere_getInvoices, create_invoice, pay_invoice,
// cancel_invoice) — unlike the removed swap feature, any Sphere-compatible
// wallet already knows how to render and handle these natively.
// ---------------------------------------------------------------------------

async function refreshInvoices() {
  const container = el('card-invoices-body');
  const state = getWalletState();
  if (state.status !== 'connected') {
    container.innerHTML = `<p class="empty-state">Connect your wallet to create or pay invoices.</p>`;
    return;
  }
  container.innerHTML = `<p class="empty-state">Loading invoices…</p>`;
  try {
    const [toPay, sent] = await Promise.all([
      getInvoices({ targetingMe: true }).catch(() => []),
      getInvoices({ createdByMe: true }).catch(() => []),
    ]);
    renderInvoicesCard(toPay, sent);
  } catch (err: any) {
    container.innerHTML = `<p class="form-error">Couldn't load invoices: ${escapeHtml(err?.message || 'unknown error')}</p>`;
  }
}

function invoiceAmountLabel(terms: any): string {
  const first = terms?.targets?.[0]?.assets?.[0]?.coin;
  if (!first) return '';
  const [coinId, amount] = first;
  return `${amount} ${coinId}`;
}

function findReceiptForInvoice(invoiceId: string): IncomingReceipt | null {
  if (!receiptsCache) return null;
  return receiptsCache.find((r) => r.receipt.invoiceId === invoiceId) || null;
}

function findInvoiceForReceipt(invoiceId: string): any | null {
  if (!sentInvoicesCache) return null;
  return sentInvoicesCache.find((inv) => inv.invoiceId === invoiceId) || null;
}

function openInvoiceReceiptPair(invoice: any, receipt: IncomingReceipt) {
  const asset = receipt.receipt.senderContribution.assets[0];
  const who = receipt.senderNametag ? `@${receipt.senderNametag}` : shortAddr(receipt.senderPubkey);
  openModal(
    'Invoice & receipt',
    `
    <div class="preview">
      <div class="preview-row"><span>Invoice for</span><strong>${escapeHtml(invoice.terms?.memo || 'Invoice')}</strong></div>
      <div class="preview-row"><span>Requested</span><strong>${escapeHtml(invoiceAmountLabel(invoice.terms))}</strong></div>
      <div class="preview-row"><span>Paid by</span><strong>${escapeHtml(who)}</strong></div>
      <div class="preview-row"><span>Status</span><strong>${escapeHtml(receipt.receipt.terminalState)}</strong></div>
      ${asset ? `<div class="preview-row"><span>Settled amount</span><strong>${escapeHtml(asset.netAmount)} ${escapeHtml(asset.coinId)}</strong></div>` : ''}
    </div>
    <p class="hint-text">This receipt is a real, cryptographically-issued record of settlement — not something ROOGLE generated or stored separately.</p>
    <div class="modal-actions"><button class="btn-primary" id="pair-close">Close</button></div>
  `
  );
  document.getElementById('pair-close')?.addEventListener('click', closeModal);
}

/** Opens a receipt on its own — pairs it with the matching sent invoice if we have one cached. */
function openReceiptDetail(receipt: IncomingReceipt) {
  const invoice = findInvoiceForReceipt(receipt.receipt.invoiceId);
  if (invoice) {
    openInvoiceReceiptPair(invoice, receipt);
    return;
  }
  const asset = receipt.receipt.senderContribution.assets[0];
  const who = receipt.senderNametag ? `@${receipt.senderNametag}` : shortAddr(receipt.senderPubkey);
  openModal(
    'Receipt',
    `
    <div class="preview">
      <div class="preview-row"><span>From</span><strong>${escapeHtml(who)}</strong></div>
      <div class="preview-row"><span>Status</span><strong>${escapeHtml(receipt.receipt.terminalState)}</strong></div>
      ${asset ? `<div class="preview-row"><span>Settled amount</span><strong>${escapeHtml(asset.netAmount)} ${escapeHtml(asset.coinId)}</strong></div>` : ''}
      ${receipt.receipt.memo ? `<div class="preview-row"><span>Memo</span><strong>${escapeHtml(receipt.receipt.memo)}</strong></div>` : ''}
    </div>
    <p class="hint-text">The matching invoice for this receipt isn't in your recent sent list, so only the receipt is shown here.</p>
    <div class="modal-actions"><button class="btn-primary" id="receipt-close">Close</button></div>
  `
  );
  document.getElementById('receipt-close')?.addEventListener('click', closeModal);
}

function renderInvoicesCard(toPay: any[], sent: any[]) {
  const container = el('card-invoices-body');
  sentInvoicesCache = sent;

  const toPayHtml =
    toPay.length === 0
      ? `<p class="empty-state">Nothing to pay right now.</p>`
      : `<ul class="listing-list">${toPay
          .map(
            (inv) => `
        <li class="listing-row listing-selectable" data-pay-id="${escapeHtml(inv.invoiceId)}">
          <span class="listing-desc">${escapeHtml(inv.terms?.memo || 'Invoice')} — ${escapeHtml(invoiceAmountLabel(inv.terms))}</span>
          <span class="listing-meta">Pay</span>
        </li>`
          )
          .join('')}</ul>`;

  const sentHtml =
    sent.length === 0
      ? `<p class="empty-state">You haven't sent any invoices yet.</p>`
      : `<ul class="listing-list">${sent
          .map((inv) => {
            const matchingReceipt = findReceiptForInvoice(inv.invoiceId);
            const statusLabel = matchingReceipt ? 'Paid — view receipt' : 'Cancel';
            const dataAttr = matchingReceipt ? `data-view-paired-id="${escapeHtml(inv.invoiceId)}"` : `data-cancel-id="${escapeHtml(inv.invoiceId)}"`;
            return `
        <li class="listing-row listing-selectable" ${dataAttr}>
          <span class="listing-desc">${escapeHtml(inv.terms?.memo || 'Invoice')} — ${escapeHtml(invoiceAmountLabel(inv.terms))}</span>
          <span class="listing-meta">${statusLabel}</span>
        </li>`;
          })
          .join('')}</ul>`;

  container.innerHTML = `
    <p class="hint-text">To pay</p>
    ${toPayHtml}
    <p class="hint-text" style="margin-top:14px">You've sent</p>
    ${sentHtml}
  `;

  container.querySelectorAll('[data-pay-id]').forEach((node) => {
    node.addEventListener('click', () => confirmPayInvoice((node as HTMLElement).dataset.payId!));
  });
  container.querySelectorAll('[data-cancel-id]').forEach((node) => {
    node.addEventListener('click', () => confirmCancelInvoice((node as HTMLElement).dataset.cancelId!));
  });
  container.querySelectorAll('[data-view-paired-id]').forEach((node) => {
    node.addEventListener('click', () => {
      const invoiceId = (node as HTMLElement).dataset.viewPairedId!;
      const invoice = sent.find((i) => i.invoiceId === invoiceId);
      const receipt = findReceiptForInvoice(invoiceId);
      if (invoice && receipt) openInvoiceReceiptPair(invoice, receipt);
    });
  });
}

function confirmPayInvoice(invoiceId: string) {
  const body = openModal(
    'Pay this invoice?',
    `<p class="empty-state">This will move real value once approved in your wallet.</p>
     <div class="modal-actions">
       <button class="btn-ghost" id="inv-pay-cancel">Cancel</button>
       <button class="btn-primary" id="inv-pay-confirm">Pay</button>
     </div>`
  );
  body.querySelector('#inv-pay-cancel')!.addEventListener('click', closeModal);
  body.querySelector('#inv-pay-confirm')!.addEventListener('click', async () => {
    body.innerHTML = `<p class="empty-state">Check your wallet to approve…</p>`;
    try {
      const result = await payInvoice(invoiceId);
      body.innerHTML = result.success
        ? `<p class="success-text">Paid.</p><div class="modal-actions"><button class="btn-primary" id="inv-pay-done">Done</button></div>`
        : `<p class="form-error">${escapeHtml(result.error || 'Payment did not complete.')}</p><div class="modal-actions"><button class="btn-ghost" id="inv-pay-done">Close</button></div>`;
      body.querySelector('#inv-pay-done')!.addEventListener('click', closeModal);
      refreshInvoices();
      refreshBalance();
    } catch (err: any) {
      body.innerHTML = `<p class="form-error">${escapeHtml(describeIntentError(err))}</p>
        <div class="modal-actions"><button class="btn-ghost" id="inv-pay-close">Close</button></div>`;
      body.querySelector('#inv-pay-close')!.addEventListener('click', closeModal);
    }
  });
}

function confirmCancelInvoice(invoiceId: string) {
  const body = openModal(
    'Cancel this invoice?',
    `<p class="empty-state">The person you sent it to won't be able to pay it after this.</p>
     <div class="modal-actions">
       <button class="btn-ghost" id="inv-cancel-back">Back</button>
       <button class="btn-primary" id="inv-cancel-confirm">Cancel invoice</button>
     </div>`
  );
  body.querySelector('#inv-cancel-back')!.addEventListener('click', closeModal);
  body.querySelector('#inv-cancel-confirm')!.addEventListener('click', async () => {
    body.innerHTML = `<p class="empty-state">Check your wallet to approve…</p>`;
    try {
      await cancelInvoice(invoiceId);
      closeModal();
      refreshInvoices();
    } catch (err: any) {
      body.innerHTML = `<p class="form-error">${escapeHtml(describeIntentError(err))}</p>
        <div class="modal-actions"><button class="btn-ghost" id="inv-cancel-close">Close</button></div>`;
      body.querySelector('#inv-cancel-close')!.addEventListener('click', closeModal);
    }
  });
}

interface InvoicePrefill {
  to?: string | null;
  amount?: string | null;
  token?: string | null;
  coinId?: string | null;
  memo?: string | null;
}

function openCreateInvoiceModal(prefill: InvoicePrefill = {}) {
  const state = getWalletState();
  if (state.status !== 'connected') {
    openModal('Connect your wallet', `<p class="empty-state">Connect your wallet first to create an invoice.</p>`);
    return;
  }
  const assets = balance || [];
  const body = openModal(
    'Request payment',
    `
    <form id="invoice-form" class="stack">
      <label>From
        <input name="to" type="text" placeholder="@nametag or address" value="${prefill.to ? escapeHtml(prefill.to) : ''}" required />
      </label>
      <label>Amount
        <input name="amount" type="text" inputmode="decimal" placeholder="0.00" value="${prefill.amount ? escapeHtml(prefill.amount) : ''}" required />
      </label>
      <label>Token
        <select name="coinId" required>
          <option value="" disabled ${!prefill.coinId ? 'selected' : ''}>Choose a token</option>
          ${assets
            .map(
              (a) =>
                `<option value="${a.coinId}" data-decimals="${a.decimals}" data-symbol="${a.symbol}" ${
                  prefill.coinId === a.coinId ? 'selected' : ''
                }>${escapeHtml(a.symbol)}</option>`
            )
            .join('')}
        </select>
      </label>
      <label>What's this for? (memo)
        <input name="memo" type="text" placeholder="e.g. Logo design, final payment" value="${prefill.memo ? escapeHtml(prefill.memo) : ''}" />
      </label>
      <div class="form-error" id="invoice-form-error"></div>
      <button type="submit" class="btn-primary">Create &amp; send</button>
    </form>
  `
  );

  body.querySelector('#invoice-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const to = String(data.get('to') || '').trim();
    const amount = String(data.get('amount') || '').trim();
    const coinId = String(data.get('coinId') || '');
    const memo = String(data.get('memo') || '').trim();
    const errorEl = body.querySelector('#invoice-form-error')!;

    if (!to) {
      errorEl.textContent = 'Enter who owes this invoice.';
      return;
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      errorEl.textContent = 'Enter an amount greater than zero.';
      return;
    }
    if (!coinId) {
      errorEl.textContent = 'Choose a token.';
      return;
    }

    const asset = assets.find((a) => a.coinId === coinId);
    errorEl.textContent = '';
    openInvoicePreview({ to, amount, coinId, memo, symbol: asset?.symbol || coinId, decimals: asset?.decimals ?? 0 });
  });
}

async function openInvoicePreview(args: { to: string; amount: string; coinId: string; memo: string; symbol: string; decimals: number }) {
  const body = openModal('Confirm invoice', `<p class="empty-state">Resolving recipient…</p>`);
  const resolved = await resolvePeer(args.to).catch(() => null);
  const targetAddress = resolved?.directAddress || args.to;
  const resolvedLabel = resolved?.nametag ? `@${resolved.nametag}` : targetAddress;

  body.innerHTML = `
    <div class="preview">
      <div class="preview-row"><span>Requesting</span><strong>${escapeHtml(args.amount)} ${escapeHtml(args.symbol)}</strong></div>
      <div class="preview-row"><span>From</span><strong>${escapeHtml(resolvedLabel)}</strong></div>
      <div class="preview-row"><span>For</span><strong>${escapeHtml(args.memo || '(no memo)')}</strong></div>
      ${!resolved ? `<p class="form-error">Could not resolve this recipient yet — double check it before continuing.</p>` : ''}
    </div>
    <p class="hint-text">This creates a real invoice token and sends it to them. They'll approve payment on their own end — nothing is deducted from you.</p>
    <div class="modal-actions">
      <button class="btn-ghost" id="inv-preview-back">Back</button>
      <button class="btn-primary" id="inv-preview-confirm">Confirm &amp; send</button>
    </div>
  `;

  body.querySelector('#inv-preview-back')!.addEventListener('click', () => openCreateInvoiceModal(args));
  body.querySelector('#inv-preview-confirm')!.addEventListener('click', async () => {
    body.innerHTML = `<p class="empty-state">Check your wallet to approve creating this invoice…</p>`;
    try {
      const smallest = toSmallestUnits(args.amount, args.decimals);
      const result = await createInvoice({
        targets: [{ address: targetAddress, assets: [{ coin: [args.coinId, smallest] }] }],
        memo: args.memo || undefined,
      });

      if (!result.success) {
        body.innerHTML = `<p class="form-error">${escapeHtml(result.error || 'Could not create the invoice.')}</p>
          <div class="modal-actions"><button class="btn-ghost" id="inv-create-close">Close</button></div>`;
        body.querySelector('#inv-create-close')!.addEventListener('click', closeModal);
        return;
      }

      // Let the recipient know directly — best-effort, doesn't block success.
      try {
        await sendDM(args.to, `You have a new invoice for ${args.amount} ${args.symbol}${args.memo ? `: ${args.memo}` : ''}. Check your Sphere wallet's invoices to pay it.`);
      } catch {
        // Non-fatal — the invoice itself still exists on-chain either way.
      }

      body.innerHTML = `
        <div class="preview"><p class="success-text">Invoice sent to ${escapeHtml(args.to)}.</p></div>
        <div class="modal-actions"><button class="btn-primary" id="inv-create-done">Done</button></div>
      `;
      body.querySelector('#inv-create-done')!.addEventListener('click', closeModal);
      refreshInvoices();
    } catch (err: any) {
      body.innerHTML = `<p class="form-error">${escapeHtml(describeIntentError(err))}</p>
        <div class="modal-actions"><button class="btn-ghost" id="inv-create-close">Close</button></div>`;
      body.querySelector('#inv-create-close')!.addEventListener('click', closeModal);
    }
  });
}

// ---------------------------------------------------------------------------
// Receipts — no dedicated query exists; these are parsed out of DMs using
// the confirmed "invoice_receipt:" wire format (see wallet.ts).
// ---------------------------------------------------------------------------

async function refreshReceipts() {
  const container = el('card-receipts-body');
  const state = getWalletState();
  if (state.status !== 'connected') {
    container.innerHTML = `<p class="empty-state">Connect your wallet to see receipts sent to you.</p>`;
    return;
  }
  container.innerHTML = `<p class="empty-state">Loading receipts…</p>`;
  try {
    const receipts = await getAllReceipts();
    receiptsCache = receipts;
    if (receipts.length === 0) {
      container.innerHTML = `<p class="empty-state">No receipts yet.</p>`;
      return;
    }
    container.innerHTML = `
      <ul class="listing-list">
        ${receipts
          .slice(0, 10)
          .map((r, i) => {
            const asset = r.receipt.senderContribution.assets[0];
            const label = asset ? `${asset.netAmount} ${asset.coinId}` : '';
            const who = r.senderNametag ? `@${r.senderNametag}` : shortAddr(r.senderPubkey);
            return `
          <li class="listing-row listing-selectable" data-receipt-index="${i}">
            <span class="listing-desc">${escapeHtml(who)} — ${escapeHtml(r.receipt.terminalState)}${r.receipt.memo ? ` — ${escapeHtml(r.receipt.memo)}` : ''}</span>
            <span class="listing-meta">${escapeHtml(label)}</span>
          </li>`;
          })
          .join('')}
      </ul>
    `;
    container.querySelectorAll('[data-receipt-index]').forEach((node) => {
      node.addEventListener('click', () => {
        const idx = Number((node as HTMLElement).dataset.receiptIndex);
        openReceiptDetail(receipts[idx]);
      });
    });
    // Re-render invoices now that receipts are available to cross-reference.
    refreshInvoices();
  } catch (err: any) {
    container.innerHTML = `<p class="form-error">Couldn't load receipts: ${escapeHtml(err?.message || 'unknown error')}</p>`;
  }
}

async function handlePromptSubmit(text: string) {
  const feedback = el('prompt-feedback');
  feedback.textContent = '';

  let parsed: { intent: 'send' | 'swap' | 'unknown'; args: any; missing: string | null };
  try {
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    parsed = await res.json();
  } catch {
    feedback.textContent = "Couldn't reach the server — try again.";
    return;
  }

  if (parsed.intent === 'swap') {
    feedback.textContent = "Swap isn't available — there's no guaranteed way to protect both sides of a token-for-token trade here. Try sending tokens directly, or use \"Request payment\" to invoice someone instead.";
    return;
  }

  if (parsed.missing) {
    feedback.textContent = parsed.missing;
    return;
  }

  if (parsed.intent === 'send') {
    openSendModal({ to: parsed.args.to, amount: parsed.args.amount, token: parsed.args.token });
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initApp() {
  onWalletChange(() => {
    renderWalletHeader();
    refreshBalance();
    refreshInvoices();
    refreshReceipts();
  });

  refreshRecentListings();

  el('btn-open-send').addEventListener('click', () => openSendModal());
  el('btn-open-invoice').addEventListener('click', () => openCreateInvoiceModal());
  el('btn-refresh-activity').addEventListener('click', () => refreshRecentListings());
  el('btn-refresh-balance').addEventListener('click', () => refreshBalance());
  el('btn-refresh-invoices').addEventListener('click', () => refreshInvoices());
  el('btn-refresh-receipts').addEventListener('click', () => refreshReceipts());

  const promptForm = el<HTMLFormElement>('prompt-form');
  promptForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = el<HTMLInputElement>('prompt-input');
    const text = input.value.trim();
    if (!text) return;
    handlePromptSubmit(text);
  });
}