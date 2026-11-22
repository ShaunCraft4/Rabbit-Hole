/**
 * Dream history (the chat-history sidebar), saved in this browser only.
 *
 * - "rabbit-hole.history" holds the index: one small HistoryEntry per dream (title, dates, status).
 * - "rabbit-hole.history.<id>" holds that dream's full snapshot (the investigation store's
 *   persisted slice), so saving one dream never rewrites the others.
 * - "rabbit-hole.sidebar" remembers whether the sidebar was left open or closed.
 *
 * Snapshots are validated again by the investigation store when a dream is reopened. When storage
 * is full, the oldest dreams are dropped to make room for the one being saved.
 */
import { create } from "zustand";

import { cleanTitle, HISTORY, parseEntries, sortEntries, titleFromQuestion, type HistoryEntry } from "@/lib/client/history";

const INDEX_KEY = "rabbit-hole.history";
const SIDEBAR_KEY = "rabbit-hole.sidebar";
const dreamKey = (id: string) => `rabbit-hole.history.${id}`;

/** Titles the planner wrote before the dream's first save landed. */
const pendingTitles = new Map<string, string>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED" || error.code === 22)
  );
}

function quietly(task: () => void): void {
  try {
    task();
  } catch {
    // Storage unavailable (private mode, blocked site data): the sidebar still works for this visit.
  }
}

function writeIndex(entries: HistoryEntry[]): void {
  quietly(() => storage()?.setItem(INDEX_KEY, JSON.stringify(entries)));
}

export interface SaveInput {
  id: string;
  question: string;
  phase: HistoryEntry["phase"];
  findings: number;
  hasReport: boolean;
}

interface HistoryState {
  hydrated: boolean;
  entries: HistoryEntry[];
  sidebarOpen: boolean;
  /** Reads the index and the sidebar state from storage (once, on the client). */
  hydrate: () => void;
  /** Saves a dream's snapshot; bumps it to the top only when something actually changed. */
  save: (input: SaveInput, snapshot: string) => void;
  /** Automatic title from the planner. Never overwrites a title the user chose. */
  nameDream: (id: string, title: string) => void;
  rename: (id: string, title: string) => void;
  remove: (id: string) => void;
  readSnapshot: (id: string) => unknown;
  setSidebarOpen: (open: boolean) => void;
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  hydrated: false,
  entries: [],
  sidebarOpen: true,

  hydrate: () => {
    if (get().hydrated) return;
    const ls = storage();
    let entries: HistoryEntry[] = [];
    let sidebarOpen = true;
    quietly(() => {
      const raw = ls?.getItem(INDEX_KEY);
      entries = raw ? parseEntries(JSON.parse(raw)) : [];
      sidebarOpen = ls?.getItem(SIDEBAR_KEY) !== "closed";
    });
    set({ hydrated: true, entries, sidebarOpen });
  },

  save: (input, snapshot) => {
    const ls = storage();
    if (!ls) return;
    get().hydrate();
    const key = dreamKey(input.id);
    const existing = get().entries.find((entry) => entry.id === input.id);
    let unchanged = false;
    quietly(() => {
      unchanged = ls.getItem(key) === snapshot;
    });
    if (unchanged && existing) return;

    const now = Date.now();
    const entry: HistoryEntry = existing
      ? { ...existing, question: input.question, phase: input.phase, findings: input.findings, hasReport: input.hasReport, updatedAt: now }
      : {
          id: input.id,
          title: pendingTitles.get(input.id) ?? titleFromQuestion(input.question),
          titleEdited: false,
          question: input.question.slice(0, HISTORY.questionChars),
          createdAt: now,
          updatedAt: now,
          phase: input.phase,
          findings: input.findings,
          hasReport: input.hasReport,
        };
    pendingTitles.delete(input.id);

    let entries = sortEntries([entry, ...get().entries.filter((item) => item.id !== input.id)]);
    for (const dropped of entries.slice(HISTORY.maxEntries)) quietly(() => ls.removeItem(dreamKey(dropped.id)));
    entries = entries.slice(0, HISTORY.maxEntries);

    // Write the snapshot; when storage is full, drop the oldest other dreams until it fits.
    for (;;) {
      try {
        ls.setItem(key, snapshot);
        break;
      } catch (error) {
        const oldest = entries.filter((item) => item.id !== input.id).at(-1);
        if (!isQuotaError(error) || !oldest) return;
        quietly(() => ls.removeItem(dreamKey(oldest.id)));
        entries = entries.filter((item) => item.id !== oldest.id);
      }
    }
    set({ entries });
    writeIndex(entries);
  },

  nameDream: (id, title) => {
    const clean = cleanTitle(title);
    if (!clean) return;
    const existing = get().entries.find((entry) => entry.id === id);
    if (!existing) {
      pendingTitles.set(id, clean);
      return;
    }
    if (existing.titleEdited || existing.title === clean) return;
    const entries = get().entries.map((entry) => (entry.id === id ? { ...entry, title: clean } : entry));
    set({ entries });
    writeIndex(entries);
  },

  rename: (id, title) => {
    const clean = cleanTitle(title);
    if (!clean) return;
    const entries = get().entries.map((entry) => (entry.id === id ? { ...entry, title: clean, titleEdited: true } : entry));
    set({ entries });
    writeIndex(entries);
  },

  remove: (id) => {
    quietly(() => storage()?.removeItem(dreamKey(id)));
    pendingTitles.delete(id);
    const entries = get().entries.filter((entry) => entry.id !== id);
    set({ entries });
    writeIndex(entries);
  },

  readSnapshot: (id) => {
    let snapshot: unknown = null;
    quietly(() => {
      const raw = storage()?.getItem(dreamKey(id));
      snapshot = raw ? JSON.parse(raw) : null;
    });
    return snapshot;
  },

  setSidebarOpen: (open) => {
    set({ sidebarOpen: open });
    quietly(() => storage()?.setItem(SIDEBAR_KEY, open ? "open" : "closed"));
  },
}));
