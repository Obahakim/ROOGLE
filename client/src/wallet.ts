/**
 * client/src/wallet.ts
 *
 * Wraps Sphere Connect (@unicitylabs/sphere-sdk/connect/browser) — the
 * non-custodial protocol for talking to a user's OWN wallet (iframe,
 * browser extension, or popup). ROOGLE's server never sees a private key
 * or mnemonic; every balance read and every send/DM requires the wallet's
 * own approval UI.
 */

import { autoConnect, type AutoConnectResult } from '@unicitylabs/sphere-sdk/connect/browser';
import { PERMISSION_SCOPES, WALLET_EVENTS, ERROR_CODES, SPHERE_NETWORKS } from '@unicitylabs/sphere-sdk/connect';

export interface WalletIdentity {
  chainPubkey: string;
  directAddress?: string;
  nametag?: string;
}

export interface Asset {
  coinId: string;
  symbol: string;
  totalAmount: string;
  decimals: number;
  tokenCount: number;
  priceUsd: number | null;
  fiatValueUsd: number | null;
}

export interface WalletState {
  status: 'disconnected' | 'connecting' | 'connected';
  identity: WalletIdentity | null;
  error: string | null;
}

let state: WalletState = { status: 'disconnected', identity: null, error: null };
let connection: AutoConnectResult | null = null;

type Listener = (s: WalletState) => void;
const listeners = new Set<Listener>();

function setState(patch: Partial<WalletState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function onWalletChange(l: Listener): () => void {
  listeners.add(l);
  l(state);
  return () => listeners.delete(l);
}

export function getWalletState(): WalletState {
  return state;
}

// The live Sphere wallet app — used as the popup fallback (P3) when ROOGLE
// isn't embedded in Sphere and the browser extension isn't installed.
const WALLET_URL = 'https://sphere.unicity.network';

const REQUESTED_PERMISSIONS = [
  PERMISSION_SCOPES.IDENTITY_READ,
  PERMISSION_SCOPES.BALANCE_READ,
  PERMISSION_SCOPES.TOKENS_READ,
  PERMISSION_SCOPES.HISTORY_READ,
  PERMISSION_SCOPES.RESOLVE_PEER,
  PERMISSION_SCOPES.TRANSFER_REQUEST,
  PERMISSION_SCOPES.DM_REQUEST,
  PERMISSION_SCOPES.DM_READ,
  PERMISSION_SCOPES.INVOICE_READ,
  PERMISSION_SCOPES.INVOICE_WRITE,
];

function describeConnectError(err: any): string {
  const code = err?.code;
  if (code === ERROR_CODES.USER_REJECTED) return 'Connection was declined in the wallet.';
  if (code === ERROR_CODES.INCOMPATIBLE_NETWORK) return "Your wallet is on a different network than this app expects.";
  if (code === ERROR_CODES.SESSION_EXPIRED) return 'Wallet session expired — please reconnect.';
  if (code === ERROR_CODES.ORIGIN_BLOCKED) return 'This site is not approved by your wallet yet.';
  return err?.message || 'Could not connect to a wallet.';
}

export async function connectWallet(): Promise<void> {
  if (state.status === 'connecting') return;
  setState({ status: 'connecting', error: null });
  try {
    const result = await autoConnect({
      dapp: {
        name: 'ROOGLE',
        url: location.origin,
        icon: location.origin + '/icon.svg',
      },
      walletUrl: WALLET_URL,
      // Required by the Connect protocol's own network-id check — omitting
      // this was the actual cause of the INCOMPATIBLE_NETWORK (4008) error.
      // The raw SDK still accepts the string 'testnet' as an alias of this
      // same network (confirmed in source), but Connect validates by this
      // numeric id specifically.
      network: SPHERE_NETWORKS.testnet2,
      permissions: REQUESTED_PERMISSIONS,
    });
    connection = result;
    setState({ status: 'connected', identity: result.client.walletIdentity, error: null });

    result.client.on(WALLET_EVENTS.LOCKED, () => {
      disconnectWallet();
    });
    result.client.on(WALLET_EVENTS.IDENTITY_CHANGED, () => {
      setState({ identity: result.client.walletIdentity });
    });

    // Survive a page refresh in popup mode.
    try {
      sessionStorage.setItem('roogle:sessionId', result.connection.sessionId);
    } catch {
      // sessionStorage unavailable (e.g. private browsing) — non-fatal.
    }
  } catch (err: any) {
    connection = null;
    setState({ status: 'disconnected', identity: null, error: describeConnectError(err) });
  }
}

export async function disconnectWallet(): Promise<void> {
  try {
    await connection?.disconnect();
  } catch {
    // best-effort cleanup
  }
  connection = null;
  try {
    sessionStorage.removeItem('roogle:sessionId');
  } catch {
    // ignore
  }
  setState({ status: 'disconnected', identity: null, error: null });
}

function requireClient() {
  if (!connection) throw new Error('Wallet is not connected.');
  return connection.client;
}

export async function getBalance(): Promise<Asset[]> {
  const client = requireClient();
  return client.query<Asset[]>('sphere_getBalance');
}

export async function resolvePeer(identifier: string): Promise<{ directAddress?: string; nametag?: string } | null> {
  const client = requireClient();
  try {
    return await client.query('sphere_resolve', { identifier });
  } catch {
    return null;
  }
}

export interface SendParams {
  to: string;
  amount: string; // smallest units — convert with format.ts before calling
  coinId: string;
}

export async function sendTokens(params: SendParams): Promise<{ id: string; status: string }> {
  const client = requireClient();
  return client.intent('send', params as unknown as Record<string, unknown>);
}

export async function sendDM(to: string, content: string): Promise<{ id: string }> {
  const client = requireClient();
  return client.intent('dm', { to, content });
}

export async function getMessages(peer: string): Promise<Array<{ senderPubkey: string; senderNametag?: string; content: string; timestamp: number }>> {
  const client = requireClient();
  return client.query('sphere_getMessages', { peer });
}

export function describeIntentError(err: any): string {
  const code = err?.code;
  if (code === ERROR_CODES.USER_REJECTED) return 'You declined this in your wallet.';
  if (code === ERROR_CODES.INSUFFICIENT_BALANCE) return "Your wallet doesn't have enough balance for this.";
  if (code === ERROR_CODES.INVALID_RECIPIENT) return "That recipient couldn't be resolved — check the address or @nametag.";
  if (code === ERROR_CODES.TRANSFER_FAILED) return 'The transfer failed on the network. Nothing was deducted twice — you can retry.';
  if (code === ERROR_CODES.INTENT_CANCELLED) return 'Cancelled.';
  return err?.message || 'Something went wrong completing that action.';
}

// ---------------------------------------------------------------------------
// Invoices — a real, standardized "request payment with terms" primitive.
// Confirmed present in Connect: sphere_getInvoices (query), create_invoice /
// pay_invoice / cancel_invoice (intents). Params for create_invoice are
// modeled on the raw SDK's CreateInvoiceRequest shape (Connect's own type is
// untyped Record<string,unknown>, same situation `send` was in — verified
// working once live). Pay/cancel param shapes are a reasonable inference
// from the same pattern and need live confirmation.
// ---------------------------------------------------------------------------

export type InvoiceState = 'OPEN' | 'PARTIAL' | 'COVERED' | 'CLOSED' | 'CANCELLED' | 'EXPIRED';

export interface InvoiceTerms {
  creator?: string;
  createdAt: number;
  dueDate?: number;
  memo?: string;
  targets: Array<{
    address: string;
    assets: Array<{ coin?: [coinId: string, amount: string] }>;
  }>;
}

export interface InvoiceRef {
  invoiceId: string;
  terms: InvoiceTerms;
  isMine?: boolean;
}

export interface CreateInvoiceParams {
  targets: Array<{ address: string; assets: Array<{ coin: [coinId: string, amount: string] }> }>;
  dueDate?: number;
  memo?: string;
}

export async function createInvoice(params: CreateInvoiceParams): Promise<{ success: boolean; invoiceId?: string; error?: string }> {
  const client = requireClient();
  return client.intent('create_invoice', params as unknown as Record<string, unknown>);
}

export async function getInvoices(options?: { createdByMe?: boolean; targetingMe?: boolean; state?: InvoiceState | InvoiceState[] }): Promise<InvoiceRef[]> {
  const client = requireClient();
  return client.query('sphere_getInvoices', options as Record<string, unknown> | undefined);
}

export async function payInvoice(invoiceId: string): Promise<{ success: boolean; error?: string }> {
  const client = requireClient();
  return client.intent('pay_invoice', { invoiceId });
}

export async function cancelInvoice(invoiceId: string): Promise<{ success: boolean; error?: string }> {
  const client = requireClient();
  return client.intent('cancel_invoice', { invoiceId });
}

export interface InvoiceReceiptPayload {
  type: 'invoice_receipt';
  version: 1;
  invoiceId: string;
  targetAddress: string;
  targetNametag?: string;
  terminalState: 'CLOSED' | 'CANCELLED';
  senderContribution: {
    senderAddress: string;
    isRefundAddress?: boolean;
    assets: Array<{ coinId: string; forwardedAmount: string; returnedAmount: string; netAmount: string; requestedAmount: string }>;
  };
  memo?: string;
  issuedAt: number;
}

export interface IncomingReceipt {
  dmId: string;
  senderPubkey: string;
  senderNametag?: string;
  receipt: InvoiceReceiptPayload;
  receivedAt: number;
}

/**
 * Receipts have no dedicated query — confirmed no GET_RECEIPTS method
 * anywhere in Connect. They're delivered as a DM whose content is prefixed
 * "invoice_receipt:" followed by JSON (confirmed wire format from SDK
 * source). This scans a peer's messages and parses out any that match.
 */
export async function getReceiptsFrom(peer: string): Promise<IncomingReceipt[]> {
  const messages = await getMessages(peer);
  const receipts: IncomingReceipt[] = [];
  for (const m of messages) {
    if (!m.content?.startsWith('invoice_receipt:')) continue;
    try {
      const payload = JSON.parse(m.content.slice('invoice_receipt:'.length)) as InvoiceReceiptPayload;
      receipts.push({
        dmId: `${m.senderPubkey}:${m.timestamp}`,
        senderPubkey: m.senderPubkey,
        senderNametag: m.senderNametag,
        receipt: payload,
        receivedAt: m.timestamp,
      });
    } catch {
      // Not a well-formed receipt — skip it rather than fail the whole scan.
    }
  }
  return receipts;
}

/**
 * Scans all known conversations for receipts. GET_CONVERSATIONS gives the
 * list of peers you've messaged; each is checked for invoice_receipt DMs.
 */
export async function getAllReceipts(): Promise<IncomingReceipt[]> {
  const client = requireClient();
  const conversations = await client.query<Array<{ peerPubkey: string }>>('sphere_getConversations');
  const all: IncomingReceipt[] = [];
  for (const c of conversations || []) {
    const fromPeer = await getReceiptsFrom(c.peerPubkey).catch(() => []);
    all.push(...fromPeer);
  }
  return all.sort((a, b) => b.receivedAt - a.receivedAt);
}