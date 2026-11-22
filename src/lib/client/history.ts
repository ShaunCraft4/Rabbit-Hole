/**
 * Dream history: pure helpers (no storage, no React) for the chat-history sidebar.
 * The store in src/stores/history.ts keeps the entries; this file decides how they are
 * titled, validated, grouped by date and searched.
 */
import { z } from "zod";

export const HISTORY = {
  /** Most dreams kept; the oldest are dropped first. */
  maxEntries: 40,
  titleChars: 80,
  questionChars: 1000,
  searchChars: 100,
} as const;

/** One saved dream as listed in the sidebar. The full snapshot lives in its own storage key. */
export interface HistoryEntry {
  /** The investigation id. */
  id: string;
  title: string;
  /** Renamed by the user: automatic titles never overwrite it. */
  titleEdited: boolean;
  question: string;
  createdAt: number;
  updatedAt: number;
  phase: "planning" | "researching" | "analyzed" | "reported";
  findings: number;
  hasReport: boolean;
}

const EntrySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  title: z.string().trim().min(1).max(HISTORY.titleChars),
  titleEdited: z.boolean().catch(false),
  question: z.string().trim().min(1).max(HISTORY.questionChars),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  phase: z.enum(["planning", "researching", "analyzed", "reported"]).catch("planning"),
  findings: z.number().int().nonnegative().catch(0),
  hasReport: z.boolean().catch(false),
});

/** Entries read back from storage: invalid ones are dropped, duplicates keep the newest. */
export function parseEntries(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, HistoryEntry>();
  for (const item of raw.slice(0, HISTORY.maxEntries * 2)) {
    const parsed = EntrySchema.safeParse(item);
    if (!parsed.success) continue;
    const prev = byId.get(parsed.data.id);
    if (!prev || prev.updatedAt < parsed.data.updatedAt) byId.set(parsed.data.id, parsed.data);
  }
  return sortEntries([...byId.values()]).slice(0, HISTORY.maxEntries);
}

export function sortEntries(entries: HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A title from the planner (or a rename): one line, no wrapping quotes or end punctuation. */
export function cleanTitle(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.replace(/\s+/g, " ").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  s = s.replace(/[.!;:,]+$/, "").trim();
  if (!s) return null;
  if (s.length > HISTORY.titleChars) s = `${s.slice(0, HISTORY.titleChars - 1).replace(/\s+\S*$/, "")}…`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Until the planner names it, a dream is titled after its question. */
export function titleFromQuestion(question: string): string {
  return cleanTitle(question.replace(/\?+$/, "")) ?? "Untitled dream";
}

export type HistoryGroupLabel = "Today" | "Yesterday" | "Previous 7 days" | "Previous 30 days" | "Older";

export interface HistoryGroup {
  label: HistoryGroupLabel;
  entries: HistoryEntry[];
}

const DAY = 24 * 60 * 60 * 1000;

/** Groups by the local calendar day of the last update, newest first; empty groups are left out. */
export function groupByDate(entries: HistoryEntry[], now: number = Date.now()): HistoryGroup[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const startToday = today.getTime();
  const startYesterday = startToday - DAY;
  const start7 = startToday - 6 * DAY;
  const start30 = startToday - 29 * DAY;
  const order: HistoryGroupLabel[] = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];
  const groups = new Map<HistoryGroupLabel, HistoryEntry[]>(order.map((label) => [label, []]));
  for (const entry of sortEntries(entries)) {
    const t = entry.updatedAt;
    const label: HistoryGroupLabel =
      t >= startToday ? "Today" : t >= startYesterday ? "Yesterday" : t >= start7 ? "Previous 7 days" : t >= start30 ? "Previous 30 days" : "Older";
    groups.get(label)!.push(entry);
  }
  return order.flatMap((label) => {
    const list = groups.get(label)!;
    return list.length ? [{ label, entries: list }] : [];
  });
}

/** Case- and accent-insensitive match on title and question; every word must appear. */
export function searchEntries(entries: HistoryEntry[], query: string): HistoryEntry[] {
  const fold = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
  const words = fold(query.slice(0, HISTORY.searchChars)).split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries;
  return entries.filter((e) => {
    const hay = fold(`${e.title} ${e.question}`);
    return words.every((w) => hay.includes(w));
  });
}

/** A short status line for the list ("Golden Key", "12 findings", "Planned"). */
export function entryStatus(entry: HistoryEntry): string {
  if (entry.hasReport) return "Golden Key";
  if (entry.phase === "planning") return "Planned";
  if (entry.findings > 0) return `${entry.findings} ${entry.findings === 1 ? "finding" : "findings"}`;
  return entry.phase === "researching" ? "Searching" : "No findings yet";
}
