import type { LogEntry } from "./types";

const LOG_KEY = "arcFavorites.log.v1";
const MAX_ENTRIES = 300;

// Writes are chained so concurrent events cannot overwrite each other.
let pending: Promise<void> = Promise.resolve();

/**
 * A small local ring buffer of lifecycle decisions (restores, repairs,
 * discards). It never leaves the device; the popup can copy it for debugging.
 */
export function appendLog(event: string, detail?: Record<string, unknown>): void {
  const entry: LogEntry = { at: Date.now(), event, ...(detail ? { detail } : {}) };
  pending = pending.then(async () => {
    const log = await readLog();
    log.push(entry);
    await chrome.storage.local.set({ [LOG_KEY]: log.slice(-MAX_ENTRIES) });
  }).catch(() => undefined);
}

export async function readLog(): Promise<LogEntry[]> {
  const stored = (await chrome.storage.local.get(LOG_KEY))[LOG_KEY];
  return Array.isArray(stored) ? (stored as LogEntry[]) : [];
}
