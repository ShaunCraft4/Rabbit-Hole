/**
 * Offline checks for the dream history (chat-history sidebar): titles, date groups, search,
 * validation, and the store's saving, renaming, deleting, restoring and full-storage handling.
 * Uses an in-memory localStorage with a size limit; no browser, no network.
 *
 *   npx tsx scripts/test-history.ts
 */
import { readFileSync } from "node:fs";

let failures = 0;
let passes = 0;
function check(ok: boolean, label: string) {
  if (ok) passes++;
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
}

/** A tiny localStorage with a quota (in UTF-16 code units, like browsers count). */
class MemoryStorage {
  private data = new Map<string, string>();
  constructor(private quota: number) {}
  get length() {
    return this.data.size;
  }
  private used(except?: string) {
    let n = 0;
    for (const [k, v] of this.data) if (k !== except) n += k.length + v.length;
    return n;
  }
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    if (this.used(key) + key.length + value.length > this.quota) {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    }
    this.data.set(key, String(value));
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  keys() {
    return [...this.data.keys()];
  }
}

const storage = new MemoryStorage(400_000);
(globalThis as unknown as { window: unknown }).window = { localStorage: storage };
(globalThis as unknown as { localStorage: unknown }).localStorage = storage;

async function main() {
  const { cleanTitle, entryStatus, groupByDate, HISTORY, parseEntries, searchEntries, titleFromQuestion } = await import(
    "@/lib/client/history"
  );
  const { useHistoryStore } = await import("@/stores/history");
  const { historySnapshot, useInvestigationStore } = await import("@/stores/investigation");
  const { InvestigationSchema } = await import("@/lib/contracts");

  // --- titles -------------------------------------------------------------------------------
  check(cleanTitle('"Funding a UCR club cultural night."') === "Funding a UCR club cultural night", "cleanTitle strips quotes and the full stop");
  check(cleanTitle("   ") === null && cleanTitle(undefined) === null, "cleanTitle rejects empty titles");
  const long = cleanTitle("word ".repeat(40))!;
  check(long.length <= HISTORY.titleChars && long.endsWith("…"), "cleanTitle cuts long titles at a word, with an ellipsis");
  check(titleFromQuestion("how do I study abroad?") === "How do I study abroad", "the fallback title is the question, tidied");

  // --- date groups --------------------------------------------------------------------------
  const now = new Date(2026, 10, 21, 15, 0).getTime();
  const at = (daysAgo: number, hour = 12) => {
    const d = new Date(2026, 10, 21 - daysAgo, hour, 0);
    return d.getTime();
  };
  const entry = (id: string, updatedAt: number, title = id) => ({
    id,
    title,
    titleEdited: false,
    question: `Question ${id}?`,
    createdAt: updatedAt,
    updatedAt,
    phase: "analyzed" as const,
    findings: 3,
    hasReport: false,
  });
  const groups = groupByDate(
    [entry("a", at(0, 1)), entry("b", at(1, 23)), entry("c", at(6, 9)), entry("d", at(7, 9)), entry("e", at(29)), entry("f", at(30)), entry("g", at(0, 14))],
    now,
  );
  const labelOf = (id: string) => groups.find((g) => g.entries.some((e) => e.id === id))?.label;
  check(labelOf("a") === "Today" && labelOf("g") === "Today", "today's dreams are under Today");
  check(labelOf("b") === "Yesterday", "a dream from late yesterday is under Yesterday");
  check(labelOf("c") === "Previous 7 days" && labelOf("d") === "Previous 30 days", "6 days ago is in the last 7 days; 7 days ago is not");
  check(labelOf("e") === "Previous 30 days" && labelOf("f") === "Older", "29 days ago is in the last 30 days; 30 days ago is Older");
  check(groups[0].entries[0].id === "g", "newest first within a group");
  check(groupByDate([], now).length === 0, "no empty groups");

  // --- search -------------------------------------------------------------------------------
  const list = [entry("x", now, "Études à l'étranger"), entry("y", now, "Funding a UCR club night"), entry("z", now, "AI research")];
  check(searchEntries(list, "etudes").length === 1, "search ignores accents");
  check(searchEntries(list, "ucr NIGHT").map((e) => e.id).join() === "y", "search needs every word, any case");
  check(searchEntries(list, "question z").map((e) => e.id).join() === "z", "search also matches the question");
  check(searchEntries(list, "   ").length === 3, "an empty search shows everything");

  // --- validation ---------------------------------------------------------------------------
  const parsed = parseEntries([entry("ok", 5), { id: "bad id!", title: "x" }, entry("dup", 1, "old"), entry("dup", 9, "new"), "junk", null]);
  check(parsed.length === 2 && parsed.find((e) => e.id === "dup")?.title === "new", "invalid entries are dropped; a duplicate keeps the newest");
  check(parseEntries("nope").length === 0 && parseEntries(Array.from({ length: 99 }, (_, i) => entry(`e${i}`, i))).length === HISTORY.maxEntries, "non-lists are ignored; at most maxEntries are kept");
  check(entryStatus({ ...entry("s", 1), hasReport: true }) === "Golden Key" && entryStatus({ ...entry("s", 1), phase: "planning" }) === "Planned", "status lines read naturally");

  // --- the store ----------------------------------------------------------------------------
  const demo = InvestigationSchema.parse(JSON.parse(readFileSync("src/fixtures/demo-investigation.json", "utf8")));
  const history = useHistoryStore.getState();
  history.hydrate();
  const snapshotFor = (id: string, question = demo.question) => {
    useInvestigationStore.setState({ investigation: { ...demo, id, question }, phase: "analyzed", savedExample: false });
    return historySnapshot(useInvestigationStore.getState());
  };
  const save = (id: string, question = demo.question) =>
    useHistoryStore.getState().save({ id, question, phase: "analyzed", findings: demo.claims.length, hasReport: true }, snapshotFor(id, question));

  useHistoryStore.getState().nameDream("dream-1", "Funding a UCR club cultural night.");
  save("dream-1");
  let e1 = useHistoryStore.getState().entries.find((e) => e.id === "dream-1");
  check(e1?.title === "Funding a UCR club cultural night", "a title named before the first save is used");
  const firstUpdate = e1!.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  save("dream-1");
  e1 = useHistoryStore.getState().entries.find((e) => e.id === "dream-1");
  check(e1?.updatedAt === firstUpdate, "saving an unchanged dream does not move it to the top");

  save("dream-2", "How do I get funding to study abroad?");
  check(useHistoryStore.getState().entries[0].id === "dream-2", "the most recently changed dream is listed first");
  check(useHistoryStore.getState().entries[0].title === "How do I get funding to study abroad", "without a planner title, the question names the dream");

  useHistoryStore.getState().rename("dream-2", "  My study abroad plan  ");
  useHistoryStore.getState().nameDream("dream-2", "Something automatic");
  const e2 = useHistoryStore.getState().entries.find((e) => e.id === "dream-2");
  check(e2?.title === "My study abroad plan" && e2.titleEdited, "a rename sticks and automatic titles never overwrite it");

  const index = JSON.parse(storage.getItem("rabbit-hole.history") ?? "[]") as { id: string }[];
  check(index.length === 2 && storage.getItem("rabbit-hole.history.dream-1") !== null, "the index and one snapshot per dream are in storage");
  check(!/"text"\s*:/.test(JSON.stringify(JSON.parse(storage.getItem("rabbit-hole.history.dream-1")!).investigation.sources)), "saved snapshots never hold page text");

  // Reopen: restore validates, settles running searches, and is not marked as a saved example.
  const snap = useHistoryStore.getState().readSnapshot("dream-1") as { investigation: { branches: { status: string }[] } };
  snap.investigation.branches[0].status = "running";
  useInvestigationStore.getState().reset();
  check(useInvestigationStore.getState().restore(snap), "a saved dream can be reopened");
  const restored = useInvestigationStore.getState();
  check(restored.investigation?.id === "dream-1" && restored.savedExample === false && restored.selectedNodeId === null, "it reopens as the user's own dream, at the overview");
  check(restored.investigation?.branches[0].status === "failed" && Boolean(restored.branchErrors[restored.investigation.branches[0].id]), "a search that was running when it was saved comes back as stopped, ready to retry");
  check(!useInvestigationStore.getState().restore({ investigation: { id: "x" } }) && !useInvestigationStore.getState().restore(null), "a broken snapshot is refused");

  // Delete.
  useHistoryStore.getState().remove("dream-2");
  check(!useHistoryStore.getState().entries.some((e) => e.id === "dream-2") && storage.getItem("rabbit-hole.history.dream-2") === null, "delete removes the entry and its snapshot");

  // Full storage: the oldest dreams make room for the newest.
  for (let i = 3; i <= 20; i++) save(`dream-${i}`);
  const kept = useHistoryStore.getState().entries;
  check(kept[0].id === "dream-20", "the newest dream is always saved, even when storage is full");
  check(kept.length < 19 && !kept.some((e) => e.id === "dream-1"), `the oldest dreams were dropped to make room (${kept.length} kept)`);
  check(kept.every((e) => storage.getItem(`rabbit-hole.history.${e.id}`) !== null), "every listed dream still has its snapshot");

  // Sidebar state.
  useHistoryStore.getState().setSidebarOpen(false);
  check(storage.getItem("rabbit-hole.sidebar") === "closed", "the collapsed state is remembered");

  console.log(failures ? `\n${failures} check(s) failed, ${passes} passed.` : `\nAll ${passes} checks passed.`);
  process.exitCode = failures ? 1 : 0;
}

main().catch((error: unknown) => {
  console.log(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
});
