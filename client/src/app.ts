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
  getMessages,
  describeIntentError,
  type Asset,
} from './wallet';
import { searchMarket, getRecentListings, addressableTarget, type MarketIntent } from './market';
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
// Swap flow — search for a real counterparty, negotiate via DM, pay on accept
// ---------------------------------------------------------------------------

interface SwapPrefill {
  fromToken?: string | null;
  toToken?: string | null;
  amount?: string | null;
}

function openSwapModal(prefill: SwapPrefill = {}) {
  const state = getWalletState();
  if (state.status !== 'connected') {
    openModal('Connect your wallet', `<p class="empty-state">Connect your wallet first — swapping needs your wallet's approval.</p>`);
    return;
  }

  const assets = balance || [];
  const body = openModal(
    'Swap tokens',
    `
    <p class="hint-text">Unicity has no instant swap — this searches the public market for someone offering the token you want, then negotiates by direct message. It can take a moment, and isn't guaranteed to find a match.</p>
    <form id="swap-form" class="stack">
      <label>From (in your wallet)
        <select name="fromCoinId" required>
          <option value="" disabled selected>Choose a token</option>
          ${assets
            .map(
              (a) =>
                `<option value="${a.coinId}" data-decimals="${a.decimals}" data-symbol="${a.symbol}" ${
                  prefill.fromToken && prefill.fromToken.toUpperCase() === a.symbol.toUpperCase() ? 'selected' : ''
                }>${escapeHtml(a.symbol)} — ${formatBalance(a.totalAmount, a.decimals, '')} available</option>`
            )
            .join('')}
        </select>
      </label>
      <label>Amount
        <input name="amount" type="text" inputmode="decimal" placeholder="0.00" value="${prefill.amount ? escapeHtml(prefill.amount) : ''}" required />
      </label>
      <label>Swap to
        <input name="toToken" type="text" placeholder="e.g. BTC" value="${prefill.toToken ? escapeHtml(prefill.toToken) : ''}" required />
      </label>
      <div class="form-error" id="swap-form-error"></div>
      <button type="submit" class="btn-primary">Find a match</button>
    </form>
  `
  );

  body.querySelector('#swap-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const fromCoinId = String(data.get('fromCoinId') || '');
    const amount = String(data.get('amount') || '').trim();
    const toToken = String(data.get('toToken') || '').trim();
    const errorEl = body.querySelector('#swap-form-error')!;

    if (!fromCoinId) {
      errorEl.textContent = 'Choose which token to swap from.';
      return;
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      errorEl.textContent = 'Enter an amount greater than zero.';
      return;
    }
    if (!toToken) {
      errorEl.textContent = 'Enter which token you want in return.';
      return;
    }

    const asset = assets.find((a) => a.coinId === fromCoinId);
    errorEl.textContent = '';
    openSwapSearch({ fromCoinId, fromSymbol: asset?.symbol || '', decimals: asset?.decimals ?? 0, amount, toToken });
  });
}

async function openSwapSearch(args: { fromCoinId: string; fromSymbol: string; decimals: number; amount: string; toToken: string }) {
  const body = openModal('Searching the market', `<p class="empty-state">Looking for someone offering ${escapeHtml(args.toToken)}…</p>`);

  let matches: MarketIntent[] = [];
  try {
    matches = await searchMarket(args.toToken);
  } catch (err: any) {
    body.innerHTML = `<p class="form-error">Search failed: ${escapeHtml(err?.message || 'unknown error')}</p>`;
    return;
  }

  if (matches.length === 0) {
    body.innerHTML = `
      <p class="empty-state">No one is currently offering ${escapeHtml(args.toToken)} on the market. Check back later, or post your own listing directly in Sphere.</p>
      <div class="modal-actions"><button class="btn-ghost" id="swap-close">Close</button></div>
    `;
    body.querySelector('#swap-close')!.addEventListener('click', closeModal);
    return;
  }

  body.innerHTML = `
    <ul class="listing-list selectable">
      ${matches
        .slice(0, 6)
        .map(
          (m, i) => `
        <li class="listing-row listing-selectable" data-index="${i}">
          <span class="listing-desc">${escapeHtml(m.description)}</span>
          <span class="listing-meta">${m.price ? `${m.price} ${escapeHtml(m.currency)}` : ''}</span>
        </li>`
        )
        .join('')}
    </ul>
  `;

  body.querySelectorAll('.listing-selectable').forEach((node) => {
    node.addEventListener('click', () => {
      const idx = Number((node as HTMLElement).dataset.index);
      openSwapNegotiate({ ...args, counterparty: matches[idx] });
    });
  });
}

async function openSwapNegotiate(args: {
  fromCoinId: string;
  fromSymbol: string;
  decimals: number;
  amount: string;
  toToken: string;
  counterparty: MarketIntent;
}) {
  const target = addressableTarget(args.counterparty);
  const body = openModal(
    'Confirm offer',
    `
    <div class="preview">
      <div class="preview-row"><span>You offer</span><strong>${escapeHtml(args.amount)} ${escapeHtml(args.fromSymbol)}</strong></div>
      <div class="preview-row"><span>For</span><strong>${escapeHtml(args.counterparty.description)}</strong></div>
      <div class="preview-row"><span>With</span><strong>${escapeHtml(target)}</strong></div>
    </div>
    <div class="modal-actions">
      <button class="btn-ghost" id="swap-cancel">Cancel</button>
      <button class="btn-primary" id="swap-send-offer">Send offer</button>
    </div>
  `
  );

  body.querySelector('#swap-cancel')!.addEventListener('click', closeModal);
  body.querySelector('#swap-send-offer')!.addEventListener('click', async () => {
    body.innerHTML = `<p class="empty-state">Check your wallet to approve sending this offer…</p>`;
    try {
      await sendDM(
        target,
        JSON.stringify({
          type: 'swap_offer',
          offering: { symbol: args.fromSymbol, amount: args.amount },
          wantingIntentId: args.counterparty.id,
        })
      );
      pollForSwapReply(target, args);
    } catch (err: any) {
      body.innerHTML = `
        <p class="form-error">${escapeHtml(describeIntentError(err))}</p>
        <div class="modal-actions"><button class="btn-ghost" id="swap-close">Close</button></div>
      `;
      body.querySelector('#swap-close')!.addEventListener('click', closeModal);
    }
  });
}

async function pollForSwapReply(
  target: string,
  args: { fromCoinId: string; fromSymbol: string; decimals: number; amount: string; toToken: string; counterparty: MarketIntent }
) {
  const body = el('modal-root').querySelector('.modal-body') as HTMLElement;
  if (!body) return;

  body.innerHTML = `<p class="empty-state">Offer sent — waiting for a reply from the other side. This can take a while; you can close this and check back.</p>
    <div class="modal-actions"><button class="btn-ghost" id="swap-give-up">Stop waiting</button></div>`;

  let stopped = false;
  body.querySelector('#swap-give-up')!.addEventListener('click', () => {
    stopped = true;
    closeModal();
  });

  const deadline = Date.now() + 2 * 60 * 1000; // 2 minutes
  while (!stopped && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    if (stopped) return;
    let messages: Awaited<ReturnType<typeof getMessages>> = [];
    try {
      messages = await getMessages(target);
    } catch {
      continue;
    }
    const reply = [...messages].reverse().find((m) => {
      try {
        const parsed = JSON.parse(m.content);
        return parsed?.type === 'swap_accepted' || parsed?.type === 'swap_rejected';
      } catch {
        return false;
      }
    });
    if (!reply) continue;

    const parsed = JSON.parse(reply.content);
    if (parsed.type === 'swap_rejected') {
      body.innerHTML = `<p class="form-error">The other side declined this offer.</p>
        <div class="modal-actions"><button class="btn-ghost" id="swap-close">Close</button></div>`;
      body.querySelector('#swap-close')!.addEventListener('click', closeModal);
      return;
    }

    // Accepted — pay.
    body.innerHTML = `<p class="empty-state">Offer accepted. Check your wallet to approve payment…</p>`;
    try {
      const smallest = toSmallestUnits(args.amount, args.decimals);
      const result = await sendTokens({ to: target, amount: smallest, coinId: args.fromCoinId });
      body.innerHTML = `
        <div class="preview"><p class="success-text">Payment sent. Transfer ID: ${escapeHtml(result.id || 'pending')}</p></div>
        <div class="modal-actions"><button class="btn-primary" id="swap-done">Done</button></div>
      `;
      body.querySelector('#swap-done')!.addEventListener('click', closeModal);
      refreshBalance();
    } catch (err: any) {
      body.innerHTML = `<p class="form-error">${escapeHtml(describeIntentError(err))}</p>
        <div class="modal-actions"><button class="btn-ghost" id="swap-close">Close</button></div>`;
      body.querySelector('#swap-close')!.addEventListener('click', closeModal);
    }
    return;
  }

  if (!stopped) {
    body.innerHTML = `<p class="empty-state">No reply yet. The offer is still open — check back in Sphere's own messages, or try again later.</p>
      <div class="modal-actions"><button class="btn-ghost" id="swap-close">Close</button></div>`;
    body.querySelector('#swap-close')?.addEventListener('click', closeModal);
  }
}

// ---------------------------------------------------------------------------
// Prompt bar — free text, no LLM, pure parsing via /api/parse
// ---------------------------------------------------------------------------

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

  if (parsed.missing) {
    feedback.textContent = parsed.missing;
    return;
  }

  if (parsed.intent === 'send') {
    openSendModal({ to: parsed.args.to, amount: parsed.args.amount, token: parsed.args.token });
  } else if (parsed.intent === 'swap') {
    openSwapModal({ fromToken: parsed.args.fromToken, toToken: parsed.args.toToken, amount: parsed.args.amount });
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
  el('btn-open-swap').addEventListener('click', () => openSwapModal());
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