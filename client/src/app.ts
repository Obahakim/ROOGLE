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
  describeIntentError,
  requestPayment,
  getWalletHistory,
  type Asset,
} from './wallet';
import { addHistoryRecord, clearHistory, exportHistory, loadHistory, saveHistory, type HistoryRecord } from './history';
import { addressableTarget, searchMarket, type MarketIntent } from './market';
import { formatBalance, toSmallestUnits } from './format';
import { identiconSvg } from './identicon';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let balance: Asset[] | null = null;
let balanceLoading = false;
let marketResults: MarketIntent[] | null = null;
let marketQuery: string | null = null;
let selectedQuote: MarketIntent | null = null;
let historyRecords: HistoryRecord[] = [];

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

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function refreshPendingHistoryStatuses(): Promise<void> {
  const pendingRecords = historyRecords.filter((record) => record.status === 'pending' && record.resultId);
  if (pendingRecords.length === 0) return;

  try {
    const walletHistory = await getWalletHistory();
    const completedIds = new Set(walletHistory.map((entry) => entry.transferId).filter(Boolean));
    let updated = false;

    historyRecords = historyRecords.map((record) => {
      if (record.status === 'pending' && record.resultId && completedIds.has(record.resultId)) {
        updated = true;
        return { ...record, status: 'success' };
      }
      return record;
    });

    if (updated) {
      saveHistory(historyRecords);
    }
  } catch {
    // Ignore refresh failures; keep pending entries until next attempt.
  }
}

async function refreshHistory(): Promise<void> {
  historyRecords = loadHistory();
  await refreshPendingHistoryStatuses();
  historyRecords = loadHistory();
  renderHistoryCard();
}

function renderHistoryCard() {
  const container = el('card-history-body');
  if (!historyRecords || historyRecords.length === 0) {
    container.innerHTML = `<p class="empty-state">No local activity recorded yet. Actions you approve in your wallet will appear here.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="history-actions">
      <button class="btn-ghost" id="history-clear">Clear history</button>
      <button class="btn-primary" id="history-export">Export proof bundle</button>
    </div>
    <ul class="history-list">
      ${historyRecords
        .slice(0, 10)
        .map(
          (record) => `
        <li class="history-row">
          <div>
            <strong>${escapeHtml(record.title)}</strong>
            <div class="history-meta">
              ${escapeHtml(formatTimestamp(record.timestamp))}
              <span class="history-status ${escapeHtml(record.status)}">${escapeHtml(record.status)}</span>
            </div>
          </div>
          <div class="history-details">
            ${record.counterparty ? `<span>${escapeHtml(record.counterparty)}</span>` : ''}
            ${record.amount ? `<span>${escapeHtml(record.amount)} ${escapeHtml(record.currency || '')}</span>` : ''}
            ${record.memo ? `<span>${escapeHtml(record.memo)}</span>` : ''}
          </div>
        </li>`
        )
        .join('')}
    </ul>
  `;

  el('history-clear').addEventListener('click', () => {
    clearHistory();
    refreshHistory();
  });
  el('history-export').addEventListener('click', () => {
    const blob = new Blob([exportHistory()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'roogle-history.json';
    link.click();
    URL.revokeObjectURL(url);
  });
}

async function performMarketSearch(query: string) {
  selectedQuote = null;
  marketQuery = query;
  marketResults = null;
  renderMarketCard();
  try {
    marketResults = await searchMarket(query);
  } catch (err: any) {
    marketResults = [];
    console.warn('Could not search market:', err?.message || err);
  }
  renderMarketCard();
}

function selectQuote(intent: MarketIntent) {
  selectedQuote = intent;
  renderMarketCard();
}

function confirmQuoteSelection(intent: MarketIntent) {
  openModal(
    'Quote selected',
    `<div class="preview">
       <div class="preview-row"><strong>Description</strong><span>${escapeHtml(intent.description)}</span></div>
       <div class="preview-row"><strong>Price</strong><span>${intent.price ? `${escapeHtml(String(intent.price))} ${escapeHtml(intent.currency)}` : 'N/A'}</span></div>
       <div class="preview-row"><strong>Agent</strong><span>${escapeHtml(addressableTarget(intent))}</span></div>
     </div>
     <div class="modal-actions">
       <button class="btn-ghost" id="quote-change">Change quote</button>
       <button class="btn-primary" id="quote-pay">Pay for quote</button>
     </div>`
  );

  el('quote-change').addEventListener('click', closeModal);
  el('quote-pay').addEventListener('click', () => {
    closeModal();
    openSendModal({ to: addressableTarget(intent), amount: intent.price ? String(intent.price) : undefined, token: intent.currency });
  });
}

function renderMarketCard() {
  const container = el('card-quotes-body');
  container.innerHTML = `
    <form id="market-search-form" class="stack">
      <label>Search market quotes
        <input id="market-search-input" type="text" placeholder="e.g. 10 UCT offers" value="${escapeHtml(marketQuery ?? '')}" />
      </label>
      <div class="market-search-actions">
        <button type="submit" class="btn-primary">Search quotes</button>
        <button type="button" class="btn-ghost" id="market-search-refresh">Clear</button>
      </div>
    </form>
    ${marketResults === null ? `<p class="empty-state">Search the public market to discover agent quotes.</p>` : ''}
    ${marketResults && marketResults.length > 0 ? `
      <ul class="listing-list">
        ${marketResults
          .slice(0, 10)
          .map(
            (it) => `
          <li class="listing-row listing-selectable ${selectedQuote?.id === it.id ? 'selected' : ''}" data-quote-id="${escapeHtml(it.id)}">
            <div>
              <strong>${escapeHtml(it.description)}</strong>
              <div class="listing-meta">${it.price ? `${it.price} ${escapeHtml(it.currency)}` : 'No price listed'}</div>
              <div class="listing-target">${escapeHtml(addressableTarget(it))}</div>
            </div>
            <button type="button" class="btn-primary btn-compact">Select</button>
          </li>`
          )
          .join('')}
      </ul>
      ${selectedQuote ? `<div class="quote-actions"><button class="btn-primary" id="quote-pay-now">Pay selected quote</button></div>` : ''}
    ` : marketResults?.length === 0 ? `<p class="empty-state">No quotes matched that search.</p>` : ''}
  `;

  const searchForm = container.querySelector<HTMLFormElement>('#market-search-form');
  searchForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = container.querySelector<HTMLInputElement>('#market-search-input');
    const query = input?.value.trim();
    if (query) performMarketSearch(query);
  });

  container.querySelectorAll<HTMLLIElement>('.listing-row.listing-selectable').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.quoteId;
      const quote = marketResults?.find((it) => it.id === id);
      if (quote) selectQuote(quote);
    });
  });

  const payNowButton = container.querySelector<HTMLButtonElement>('#quote-pay-now');
  if (payNowButton && selectedQuote) {
    payNowButton.addEventListener('click', () => confirmQuoteSelection(selectedQuote!));
  }

  container.querySelector<HTMLButtonElement>('#market-search-refresh')?.addEventListener('click', () => {
    marketQuery = null;
    marketResults = null;
    selectedQuote = null;
    renderMarketCard();
  });
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
      addHistoryRecord({
        action: 'send',
        status: 'pending',
        title: `Sent ${args.amount} ${args.symbol}`,
        counterparty: resolvedLabel,
        amount: args.amount,
        currency: args.symbol,
        coinId: args.coinId,
        resultId: result.id,
        proof: result.id,
      });
      await refreshHistory();
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

      if (result.success) {
        addHistoryRecord({
          action: 'request_payment',
          status: 'pending',
          title: `Requested ${args.amount} ${args.symbol}`,
          counterparty: args.to,
          amount: args.amount,
          currency: args.symbol,
          coinId: args.coinId,
          memo: args.memo,
          details: `Request approved by wallet and sent to ${args.to}`,
        });
        await refreshHistory();
      }

      body.innerHTML = result.success
        ? `<div class="preview"><p class="success-text">Request sent to ${escapeHtml(args.to)}.</p></div>
           <div class="modal-actions"><button class="btn-primary" id="req-done">Done</button></div>`
        : `<p class="form-error">${escapeHtml(result.error || 'Could not send the request.')}</p>
           <div class="modal-actions"><button class="btn-ghost" id="req-done">Close</button></div>`;
      body.querySelector('#req-done')!.addEventListener('click', closeModal);
    } catch (err: any) {
      body.innerHTML = `
        <p class="form-error">${escapeHtml(describeIntentError(err))}</p>
        <div class="modal-actions"><button class="btn-ghost" id="req-close">Close</button></div>`;
      body.querySelector('#req-close')!.addEventListener('click', closeModal);
    }
  });
}


async function handlePromptSubmit(text: string) {
  const feedback = el('prompt-feedback');
  feedback.textContent = '';

  let parsed: { intent: 'send' | 'swap' | 'search_market' | 'unknown'; args: any; missing: string | null };
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

  if (parsed.intent === 'search_market') {
    if (parsed.missing) {
      feedback.textContent = parsed.missing;
      return;
    }
    performMarketSearch(parsed.args.query || text);
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
    void refreshHistory();
  });

  void refreshHistory();
  renderMarketCard();

  el('btn-open-send').addEventListener('click', () => openSendModal());
  el('btn-open-request').addEventListener('click', () => openRequestPaymentModal());
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