export type HistoryAction = 'send' | 'request_payment' | 'market_search';
export type HistoryStatus = 'success' | 'failure';

export interface HistoryRecord {
  id: string;
  timestamp: number;
  action: HistoryAction;
  status: HistoryStatus;
  title: string;
  counterparty?: string;
  amount?: string;
  currency?: string;
  coinId?: string;
  memo?: string;
  resultId?: string;
  proof?: string;
  details?: string;
}

const STORAGE_KEY = 'roogle:history';
const MAX_RECORDS = 50;

function safeParse(value: string | null): HistoryRecord[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadHistory(): HistoryRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  return safeParse(window.localStorage.getItem(STORAGE_KEY));
}

export function saveHistory(records: HistoryRecord[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function addHistoryRecord(record: Omit<HistoryRecord, 'id' | 'timestamp'> & Partial<Pick<HistoryRecord, 'id' | 'timestamp'>>): HistoryRecord {
  const existing = loadHistory();
  const timestamp = record.timestamp ?? Date.now();
  const id = record.id ?? `history-${timestamp}-${Math.random().toString(36).slice(2, 10)}`;
  const normalized: HistoryRecord = {
    id,
    timestamp,
    ...record,
  };
  const updated = [normalized, ...existing].slice(0, MAX_RECORDS);
  saveHistory(updated);
  return normalized;
}

export function clearHistory(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function exportHistory(): string {
  return JSON.stringify(loadHistory(), null, 2);
}
