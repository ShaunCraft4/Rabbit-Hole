"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText, PanelLeftClose, PanelLeftOpen, Pencil, Search, SquarePen, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { DREAM } from "@/components/DreamScene";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { entryStatus, groupByDate, HISTORY, searchEntries, type HistoryEntry } from "@/lib/client/history";
import { cn } from "@/lib/utils";
import { useHistoryStore } from "@/stores/history";
import { useInvestigationStore } from "@/stores/investigation";

const PANEL_ID = "dream-history";

/**
 * The dream history: a collapsible sidebar like a chat app's. On desktop it pushes the page over
 * (expanded) or shrinks to an icon rail (collapsed), and remembers which; on phones it opens as an
 * overlay. Lists every saved dream by date, with search, rename and delete; clicking one reopens it.
 */
export function HistorySidebar({ onNewDream }: { onNewDream: () => void }) {
  const router = useRouter();
  const hydrated = useHistoryStore((state) => state.hydrated);
  const entries = useHistoryStore((state) => state.entries);
  const open = useHistoryStore((state) => state.sidebarOpen);
  const setOpen = useHistoryStore((state) => state.setSidebarOpen);
  const currentId = useInvestigationStore((state) => (state.savedExample ? null : (state.investigation?.id ?? null)));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [focusSearch, setFocusSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<HistoryEntry | null>(null);

  useEffect(() => {
    useHistoryStore.getState().hydrate();
    // Turn on the width animation only after the remembered state is applied, so a collapsed
    // sidebar does not visibly shut on every page load. The clock for the date groups is read
    // here, in the browser (never while prerendering), and refreshed so "Today" rolls over.
    const frame = requestAnimationFrame(() => {
      setAnimate(true);
      setNow(Date.now());
    });
    const tick = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(tick);
    };
  }, []);

  function newDream() {
    setMobileOpen(false);
    onNewDream();
  }

  function openDream(entry: HistoryEntry) {
    const snapshot = useHistoryStore.getState().readSnapshot(entry.id);
    if (!useInvestigationStore.getState().restore(snapshot)) {
      toast.error("This dream could not be reopened. It may have been saved by an older version.");
      return;
    }
    setMobileOpen(false);
    router.push("/dream", { transitionTypes: [DREAM.sink] });
  }

  function confirmDelete() {
    if (!deleting) return;
    useHistoryStore.getState().remove(deleting.id);
    if (deleting.id === currentId) useInvestigationStore.getState().reset();
    toast.message(`Deleted “${deleting.title}”.`);
    setDeleting(null);
  }

  const panel = (variant: "desktop" | "mobile") => (
    <HistoryPanel
      variant={variant}
      hydrated={hydrated && now !== null}
      now={now ?? 0}
      entries={entries}
      currentId={currentId}
      query={query}
      onQuery={setQuery}
      autoFocusSearch={focusSearch}
      onSearchFocused={() => setFocusSearch(false)}
      onCollapse={() => setOpen(false)}
      onNewDream={newDream}
      onOpen={openDream}
      onDelete={setDeleting}
    />
  );

  return (
    <>
      {/* Desktop: pushes the page; expanded panel or a narrow icon rail. */}
      <nav
        id={PANEL_ID}
        aria-label="Dream history"
        data-hydrated={hydrated ? "true" : "false"}
        data-count={entries.length}
        className={cn(
          "sticky top-0 z-20 hidden h-dvh shrink-0 overflow-hidden border-r border-border bg-wonderland/40 backdrop-blur-sm md:block",
          animate && "transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          open ? "w-72" : "w-14",
        )}
      >
        <div key={open ? "panel" : "rail"} className={cn("dream-swap h-full", open ? "w-72" : "w-14")}>
          {open ? (
            panel("desktop")
          ) : (
            <Rail
              onExpand={() => setOpen(true)}
              onNewDream={newDream}
              onSearch={() => {
                setFocusSearch(true);
                setOpen(true);
              }}
            />
          )}
        </div>
      </nav>

      {/* Phones: a button in the top-left corner opens the history as an overlay. */}
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="fixed top-3 left-3 z-30 cursor-pointer bg-midnight/80 backdrop-blur-sm md:hidden"
        aria-label="Open dream history"
        aria-expanded={mobileOpen}
        aria-controls={`${PANEL_ID}-mobile`}
        onClick={() => setMobileOpen(true)}
      >
        <PanelLeftOpen aria-hidden />
      </Button>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          id={`${PANEL_ID}-mobile`}
          side="left"
          className="w-[min(20rem,86vw)] gap-0 border-border bg-wonderland p-0 text-paper"
        >
          <SheetTitle className="sr-only">Dream history</SheetTitle>
          <SheetDescription className="sr-only">Your saved dreams. Open one to continue where you left off.</SheetDescription>
          {panel("mobile")}
        </SheetContent>
      </Sheet>

      <Dialog open={deleting !== null} onOpenChange={(next) => (next ? null : setDeleting(null))}>
        <DialogContent className="border-border bg-wonderland text-paper sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl text-paper">Delete this dream?</DialogTitle>
            <DialogDescription className="text-paper/75">
              “{deleting?.title}” and everything found in it will be removed from this browser. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="cursor-pointer" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" className="cursor-pointer" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RailButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="cursor-pointer text-paper/80" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function Rail({ onExpand, onNewDream, onSearch }: { onExpand: () => void; onNewDream: () => void; onSearch: () => void }) {
  return (
    <div className="flex h-full flex-col items-center gap-2 py-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="cursor-pointer text-paper/80"
            aria-label="Open the sidebar"
            aria-expanded={false}
            aria-controls={PANEL_ID}
            onClick={onExpand}
          >
            <PanelLeftOpen aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Open the sidebar</TooltipContent>
      </Tooltip>
      <RailButton label="New dream" onClick={onNewDream}>
        <SquarePen aria-hidden />
      </RailButton>
      <RailButton label="Search dreams" onClick={onSearch}>
        <Search aria-hidden />
      </RailButton>
      <RailButton label="Your dreams" onClick={onExpand}>
        <MessageSquareText aria-hidden />
      </RailButton>
    </div>
  );
}

interface PanelProps {
  variant: "desktop" | "mobile";
  /** History loaded and the clock read (both happen in the browser only). */
  hydrated: boolean;
  now: number;
  entries: HistoryEntry[];
  currentId: string | null;
  query: string;
  onQuery: (query: string) => void;
  autoFocusSearch: boolean;
  onSearchFocused: () => void;
  onCollapse: () => void;
  onNewDream: () => void;
  onOpen: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => void;
}

function HistoryPanel(props: PanelProps) {
  const { variant, hydrated, now, entries, currentId, query, onQuery, autoFocusSearch, onSearchFocused } = props;
  const searchRef = useRef<HTMLInputElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const groups = useMemo(
    () => (hydrated ? groupByDate(searchEntries(entries, query), now) : []),
    [hydrated, entries, query, now],
  );

  useEffect(() => {
    if (!autoFocusSearch) return;
    searchRef.current?.focus();
    onSearchFocused();
  }, [autoFocusSearch, onSearchFocused]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className={cn("flex min-h-9 items-center justify-between gap-2", variant === "mobile" && "pr-8")}>
        <p className="pl-1 font-mono text-xs tracking-[0.2em] text-golden uppercase">Your dreams</p>
        {variant === "desktop" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="cursor-pointer text-paper/80"
                aria-label="Close the sidebar"
                aria-expanded
                aria-controls={PANEL_ID}
                onClick={props.onCollapse}
              >
                <PanelLeftClose aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Close the sidebar</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <Button type="button" className="h-10 w-full cursor-pointer justify-start gap-2 px-3 text-sm" onClick={props.onNewDream}>
        <SquarePen aria-hidden />
        New dream
      </Button>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-paper/50" aria-hidden />
        <Input
          ref={searchRef}
          type="search"
          value={query}
          maxLength={HISTORY.searchChars}
          placeholder="Search dreams"
          aria-label="Search dreams"
          className="h-9 bg-midnight/40 pr-8 pl-8 text-sm"
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              onQuery("");
            }
          }}
        />
        {query ? (
          <button
            type="button"
            className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded text-paper/60 transition-colors duration-300 hover:text-paper focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
            aria-label="Clear the search"
            onClick={() => {
              onQuery("");
              searchRef.current?.focus();
            }}
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {!hydrated ? null : entries.length === 0 ? (
          <p className="dream-reveal px-2 pt-4 text-sm leading-6 text-paper/65">
            No dreams yet. Every question you ask is saved here, so you can come back to it.
          </p>
        ) : groups.length === 0 ? (
          <p className="dream-reveal px-2 pt-4 text-sm leading-6 text-paper/65">No dreams match “{query.trim()}”.</p>
        ) : (
          groups.map((group) => (
            <section key={group.label} aria-labelledby={`history-${variant}-${group.label}`} className="pt-2">
              <h3
                id={`history-${variant}-${group.label}`}
                className="px-2 pt-2 pb-1 font-mono text-[10px] tracking-[0.16em] text-paper/55 uppercase"
              >
                {group.label}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {group.entries.map((entry) => (
                  <HistoryRow
                    key={entry.id}
                    entry={entry}
                    current={entry.id === currentId}
                    renaming={renamingId === entry.id}
                    onRename={() => setRenamingId(entry.id)}
                    onRenameDone={() => setRenamingId(null)}
                    onOpen={() => props.onOpen(entry)}
                    onDelete={() => props.onDelete(entry)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <p className="px-1 text-[11px] leading-4 text-paper/50">Saved in this browser only.</p>
    </div>
  );
}

function HistoryRow({
  entry,
  current,
  renaming,
  onRename,
  onRenameDone,
  onOpen,
  onDelete,
}: {
  entry: HistoryEntry;
  current: boolean;
  renaming: boolean;
  onRename: () => void;
  onRenameDone: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const rename = useHistoryStore((state) => state.rename);
  const [draft, setDraft] = useState(entry.title);

  function save(event?: FormEvent) {
    event?.preventDefault();
    if (draft.trim() && draft.trim() !== entry.title) rename(entry.id, draft);
    onRenameDone();
  }

  if (renaming) {
    return (
      <li className="dream-reveal px-0.5 py-0.5">
        <form onSubmit={save}>
          <Input
            autoFocus
            value={draft}
            maxLength={HISTORY.titleChars}
            aria-label={`Rename “${entry.title}”`}
            className="h-9 bg-midnight/60 text-sm"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => save()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setDraft(entry.title);
                onRenameDone();
              }
            }}
          />
        </form>
      </li>
    );
  }

  return (
    <li className="group/row relative">
      <button
        type="button"
        title={entry.title}
        aria-current={current ? "page" : undefined}
        className={cn(
          "flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-[background-color,box-shadow] duration-300 group-focus-within/row:pr-14 group-hover/row:pr-14 [@media(hover:none)]:pr-14 hover:bg-paper/8 hover:shadow-[0_0_16px_-8px_rgb(215_201_246/0.6)] focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none",
          current && "bg-mystic/30 shadow-[inset_2px_0_0_var(--golden-key)]",
        )}
        onClick={onOpen}
      >
        <span className="block truncate text-sm text-paper">{entry.title}</span>
        <span className={cn("block truncate text-[11px]", entry.hasReport ? "text-golden/85" : "text-paper/55")}>
          {current ? "Open now · " : ""}
          {entryStatus(entry)}
        </span>
      </button>
      <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity duration-300 group-focus-within/row:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="cursor-pointer text-paper/70"
          aria-label={`Rename “${entry.title}”`}
          onClick={() => {
            setDraft(entry.title);
            onRename();
          }}
        >
          <Pencil aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="cursor-pointer text-paper/70 hover:text-destructive"
          aria-label={`Delete “${entry.title}”`}
          onClick={onDelete}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  );
}
