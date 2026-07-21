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
  requestPayment,
  type Asset,
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
  if (balance === null || balanceLoading) {
    // Balance fetch hasn't resolved yet — show a real state and retry,
    // instead of a token dropdown with nothing in it.
    const body = openModal('Loading your balance…', `<p class="empty-state">One moment — fetching your tokens.</p>`);
    refreshBalance().then(() => {
      if (document.getElementById('modal-root')?.classList.contains('open')) {
        closeModal();
        openSendModal(prefill);
      }
    });
    return;
  }
  if (balance.length === 0) {
    openModal(
      'No tokens found',
      `<p class="empty-state">Your connected wallet doesn't show any tokens right now. If you expect a balance, try Refresh on the Balance card first.</p>
       <div class="modal-actions"><button class="btn-ghost" id="send-empty-close">Close</button></div>`
    );
    document.getElementById('send-empty-close')?.addEventListener('click', closeModal);
    return;
  }

  const assets = balance;
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
// Request Payment — confirmed real by the Unicity/Sphere team directly:
// the wallet's handler set is { send, payment_request, dm, sign_message,
// mint, receive }. This is one-sided by design (see wallet.ts) — there's
// no query to list requests you've sent, so success here just means the
// request was handed to the wallet; whether it gets paid shows up later
// as a balance change, not a status you can track in ROOGLE.
// ---------------------------------------------------------------------------

interface RequestPaymentPrefill {
  to?: string | null;
  amount?: string | null;
  token?: string | null;
  coinId?: string | null;
  memo?: string | null;
}

function openRequestPaymentModal(prefill: RequestPaymentPrefill = {}) {
  const state = getWalletState();
  if (state.status !== 'connected') {
    openModal('Connect your wallet', `<p class="empty-state">Connect your wallet first to request a payment.</p>`);
    return;
  }
  if (balance === null || balanceLoading) {
    openModal('Loading your balance…', `<p class="empty-state">One moment — fetching your tokens.</p>`);
    refreshBalance().then(() => {
      if (document.getElementById('modal-root')?.classList.contains('open')) {
        closeModal();
        openRequestPaymentModal(prefill);
      }
    });
    return;
  }
  if (balance.length === 0) {
    openModal(
      'No tokens found',
      `<p class="empty-state">Your connected wallet doesn't show any tokens right now. If you expect a balance, try Refresh on the Balance card first.</p>
       <div class="modal-actions"><button class="btn-ghost" id="req-empty-close">Close</button></div>`
    );
    document.getElementById('req-empty-close')?.addEventListener('click', closeModal);
    return;
  }
  const assets = balance;

  const body = openModal(
    'Request payment',
    `
    <p class="hint-text">This asks someone to pay you — they'll see and approve it in their own wallet. There's no way to track it here once sent; check your Balance to see if it landed.</p>
    <form id="request-form" class="stack">
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
      <div class="form-error" id="request-form-error"></div>
      <button type="submit" class="btn-primary">Preview</button>
    </form>
  `
  );

  body.querySelector('#request-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const to = String(data.get('to') || '').trim();
    const amount = String(data.get('amount') || '').trim();
    const coinId = String(data.get('coinId') || '');
    const memo = String(data.get('memo') || '').trim();
    const errorEl = body.querySelector('#request-form-error')!;

    if (!to) {
      errorEl.textContent = 'Enter who you want to request payment from.';
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
    openRequestPaymentPreview({ to, amount, coinId, memo, symbol: asset?.symbol || coinId, decimals: asset?.decimals ?? 0 });
  });
}

async function openRequestPaymentPreview(args: { to: string; amount: string; coinId: string; memo: string; symbol: string; decimals: number }) {
  const body = openModal('Confirm request', `<p class="empty-state">Resolving recipient…</p>`);
  const resolved = await resolvePeer(args.to).catch(() => null);
  const resolvedLabel = resolved?.nametag ? `@${resolved.nametag}` : resolved?.directAddress || args.to;

  body.innerHTML = `
    <div class="preview">
      <div class="preview-row"><span>Requesting</span><strong>${escapeHtml(args.amount)} ${escapeHtml(args.symbol)}</strong></div>
      <div class="preview-row"><span>From</span><strong>${escapeHtml(resolvedLabel)}</strong></div>
      <div class="preview-row"><span>For</span><strong>${escapeHtml(args.memo || '(no memo)')}</strong></div>
      ${!resolved ? `<p class="form-error">Could not resolve this recipient yet — double check it before continuing.</p>` : ''}
    </div>
    <div class="modal-actions">
      <button class="btn-ghost" id="req-preview-back">Back</button>
      <button class="btn-primary" id="req-preview-confirm">Confirm &amp; send</button>
    </div>
  `;

  body.querySelector('#req-preview-back')!.addEventListener('click', () => openRequestPaymentModal(args));
  body.querySelector('#req-preview-confirm')!.addEventListener('click', async () => {
    body.innerHTML = `<p class="empty-state">Check your wallet to approve sending this request…</p>`;
    try {
      const smallest = toSmallestUnits(args.amount, args.decimals);
      const result = await requestPayment({ to: args.to, amount: smallest, coinId: args.coinId, memo: args.memo || undefined });

      body.innerHTML = result.success
        ? `<div class="preview"><p class="success-text">Request sent to ${escapeHtml(args.to)}.</p></div>
           <div class="modal-actions"><button class="btn-primary" id="req-done">Done</button></div>`
        : `<p class="form-error">${escapeHtml(result.error || 'Could not send the request.')}</p>
           <div class="modal-actions"><button class="btn-ghost" id="req-done">Close</button></div>`;
      body.querySelector('#req-done')!.addEventListener('click', closeModal);
    } catch (err: any) {
      body.innerHTML = `<p class="form-error">${escapeHtml(describeIntentError(err))}</p>
        <div class="modal-actions"><button class="btn-ghost" id="req-close">Close</button></div>`;
      body.querySelector('#req-close')!.addEventListener('click', closeModal);
    }
  });
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
    feedback.textContent = "Swap isn't available — there's no guaranteed way to protect both sides of a token-for-token trade here. Try sending tokens directly, or use \"Request payment\" instead.";
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
  });

  refreshRecentListings();

  el('btn-open-send').addEventListener('click', () => openSendModal());
  el('btn-open-request').addEventListener('click', () => openRequestPaymentModal());
  el('btn-refresh-activity').addEventListener('click', () => refreshRecentListings());
  el('btn-refresh-balance').addEventListener('click', () => refreshBalance());

  const promptForm = el<HTMLFormElement>('prompt-form');
  promptForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = el<HTMLInputElement>('prompt-input');
    const text = input.value.trim();
    if (!text) return;
    handlePromptSubmit(text);
  });
}