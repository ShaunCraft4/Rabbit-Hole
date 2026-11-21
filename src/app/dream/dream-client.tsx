"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { ListView } from "@/components/list/ListView";
import { BranchActivity } from "@/components/panels/BranchActivity";
import { CheshirePanel } from "@/components/panels/CheshirePanel";
import { DiscoveryPanel } from "@/components/panels/DiscoveryPanel";
import { WorkspaceHeader } from "@/components/panels/WorkspaceHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError } from "@/lib/client/api";
import { runResearchAll } from "@/lib/client/runner";
import { LIMITS } from "@/lib/contracts";
import { branchNodeId } from "@/lib/graph/build";
import type { BranchStatus } from "@/lib/types";
import { useInvestigationStore } from "@/stores/investigation";

const STATUS_LABEL: Record<BranchStatus, string> = {
  idle: "Idle",
  running: "Searching",
  done: "Done",
  failed: "Failed",
};

let rehydrateStarted = false;

function subscribeHydration(onStoreChange: () => void): () => void {
  return useInvestigationStore.persist.onFinishHydration(onStoreChange);
}

function hydrationSnapshot(): boolean {
  return useInvestigationStore.persist.hasHydrated();
}

function hydrationServerSnapshot(): boolean {
  return false;
}

function useInvestigationHydrated(): boolean {
  const hydrated = useSyncExternalStore(subscribeHydration, hydrationSnapshot, hydrationServerSnapshot);

  useEffect(() => {
    if (useInvestigationStore.persist.hasHydrated() || rehydrateStarted) return;
    rehydrateStarted = true;
    void useInvestigationStore.persist.rehydrate();
  }, []);

  return hydrated;
}

function isSelectableNode(value: string): boolean {
  return value.length > 0 && value.length <= 160 && /^[A-Za-z0-9_:-]+$/.test(value);
}

/** Reads `?node=` after the store has rehydrated and selects that node. */
export function SelectNodeFromUrl() {
  const params = useSearchParams();
  const hydrated = useInvestigationHydrated();
  const setSelected = useInvestigationStore((state) => state.setSelected);
  const node = params.get("node");

  useEffect(() => {
    if (!hydrated || !node || !isSelectableNode(node)) return;
    setSelected(node);
  }, [hydrated, node, setSelected]);

  return null;
}

function DreamPending() {
  return (
    <div className="min-h-dvh" aria-busy="true">
      <p className="sr-only">Loading your dream</p>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return "The investigation could not be finished.";
}

export function DreamWorkspace({ goldenKey }: { goldenKey: ReactNode }) {
  const router = useRouter();
  const hydrated = useInvestigationHydrated();
  const investigation = useInvestigationStore((state) => state.investigation);
  const phase = useInvestigationStore((state) => state.phase);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!investigation || phase === "entrance") router.replace("/");
  }, [hydrated, investigation, phase, router]);

  async function openDoors() {
    setFlowError(null);
    setOpening(true);
    try {
      await runResearchAll();
    } catch (error) {
      const message = errorMessage(error);
      setFlowError(message);
      toast.error(message);
    } finally {
      setOpening(false);
    }
  }

  if (!hydrated || !investigation || phase === "entrance") return <DreamPending />;

  return (
    <>
      <ArrivalVeil />
      {phase === "planning" ? (
        <PlanningView opening={opening} flowError={flowError} onOpen={() => void openDoors()} />
      ) : (
        <WorkspaceView flowError={flowError} goldenKey={goldenKey} />
      )}
    </>
  );
}

function ArrivalVeil() {
  return <div className="arrival-veil" aria-hidden />;
}

function SavedExampleNote() {
  const savedExample = useInvestigationStore((state) => state.savedExample);
  if (!savedExample) return null;
  return (
    <p className="border-b border-golden/40 bg-wonderland/70 px-4 py-2 text-sm text-paper">
      Saved example. These results were recorded earlier, not searched just now.
    </p>
  );
}

function StatusChip({ status }: { status: BranchStatus }) {
  const tone =
    status === "done"
      ? "border-golden text-golden"
      : status === "failed"
        ? "border-destructive text-destructive"
        : status === "running"
          ? "border-mystic text-mystic-ink"
          : "border-paper/40 text-paper";

  return (
    <Badge variant="outline" className={tone}>
      {status === "running" ? (
        <span className="status-pulse mr-1.5 inline-block size-1.5 rounded-full bg-mystic-ink" aria-hidden />
      ) : null}
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function PlanningView({
  opening,
  flowError,
  onOpen,
}: {
  opening: boolean;
  flowError: string | null;
  onOpen: () => void;
}) {
  const investigation = useInvestigationStore((state) => state.investigation);
  const deleteBranch = useInvestigationStore((state) => state.deleteBranch);
  const editBranch = useInvestigationStore((state) => state.editBranch);
  const addBranch = useInvestigationStore((state) => state.addBranch);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  if (!investigation) return null;
  const atLimit = investigation.branches.length >= LIMITS.maxBranches;

  function saveQuestion(branchId: string) {
    const next = draft.trim();
    if (!next) {
      setEditError("A door needs a question.");
      return;
    }
    editBranch(branchId, next);
    setEditingId(null);
    setEditError(null);
  }

  function saveBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !question.trim()) {
      setAddError("A door needs a title and a question.");
      return;
    }
    if (atLimit) {
      setAddError("You already have as many doors as this dream can hold.");
      return;
    }
    addBranch({ title, question });
    setTitle("");
    setQuestion("");
    setAdding(false);
    setAddError(null);
  }

  return (
    <main className="fall-in mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-12">
      <SavedExampleNote />
      <header className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-[0.18em] text-golden uppercase">The White Rabbit</p>
        <h1 className="font-heading text-4xl text-paper sm:text-5xl">The plan before the fall</h1>
        <p className="text-paper/80">{investigation.question}</p>
        {investigation.assumptions.length > 0 ? (
          <p className="text-sm leading-6 text-paper/70">{investigation.assumptions.join(" ")}</p>
        ) : (
          <p className="text-sm text-paper/75">No assumptions yet. The doors below are the paths we will search.</p>
        )}
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="doors-heading">
        <h2 id="doors-heading" className="font-heading text-2xl text-paper">
          Doors
        </h2>
        {investigation.branches.length === 0 ? (
          <p className="text-sm text-paper/70">The White Rabbit needs at least one door.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {investigation.branches.map((branch) => (
              <li key={branch.id}>
                <Card className="bg-wonderland/70">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-heading text-2xl text-paper">{branch.title}</h3>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0 cursor-pointer"
                        aria-label={`Remove ${branch.title}`}
                        onClick={() => deleteBranch(branch.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {editingId === branch.id ? (
                      <form
                        className="flex flex-col gap-3"
                        onSubmit={(event) => {
                          event.preventDefault();
                          saveQuestion(branch.id);
                        }}
                      >
                        <label htmlFor={`question-${branch.id}`} className="sr-only">
                          Research question for {branch.title}
                        </label>
                        <Textarea
                          id={`question-${branch.id}`}
                          value={draft}
                          maxLength={LIMITS.branchQuestionChars}
                          className="min-h-24 bg-midnight/40 text-base md:text-base"
                          onChange={(event) => setDraft(event.target.value)}
                        />
                        {editError ? (
                          <p role="alert" className="text-sm text-destructive">
                            {editError}
                          </p>
                        ) : null}
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" className="cursor-pointer">
                            Save question
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="cursor-pointer"
                            onClick={() => {
                              setEditingId(null);
                              setEditError(null);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="w-full cursor-pointer rounded-md text-left text-sm leading-6 text-paper/85 focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
                        onClick={() => {
                          setEditingId(branch.id);
                          setDraft(branch.question);
                          setEditError(null);
                        }}
                      >
                        {branch.question}
                        <span className="sr-only">. Edit question</span>
                      </button>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="add-door-heading">
        <h2 id="add-door-heading" className="font-heading text-2xl text-paper">
          Add a door
        </h2>
        {adding ? (
          <form onSubmit={saveBranch} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="door-title" className="text-sm text-paper/80">
                Title
              </label>
              <Input
                id="door-title"
                value={title}
                maxLength={LIMITS.branchTitleChars}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="door-question" className="text-sm text-paper/80">
                Question
              </label>
              <Textarea
                id="door-question"
                value={question}
                maxLength={LIMITS.branchQuestionChars}
                className="min-h-20 bg-wonderland/40 text-base md:text-base"
                onChange={(event) => setQuestion(event.target.value)}
              />
            </div>
            {addError ? (
              <p role="alert" className="text-sm text-destructive">
                {addError}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" size="sm" className="cursor-pointer" disabled={atLimit}>
                Add this door
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="cursor-pointer"
                onClick={() => {
                  setAdding(false);
                  setAddError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-fit cursor-pointer"
            disabled={atLimit}
            onClick={() => setAdding(true)}
          >
            {atLimit ? "No room for another door" : "Add a custom door"}
          </Button>
        )}
      </section>

      {flowError ? (
        <p role="alert" className="text-sm text-destructive">
          {flowError}
        </p>
      ) : null}

      <Button
        type="button"
        size="lg"
        className="h-12 cursor-pointer px-6 text-base"
        disabled={opening || investigation.branches.length === 0}
        onClick={onOpen}
      >
        {opening ? "Opening the doors…" : "Open the doors"}
      </Button>
    </main>
  );
}

function WorkspaceView({ flowError, goldenKey }: { flowError: string | null; goldenKey: ReactNode }) {
  const investigation = useInvestigationStore((state) => state.investigation);
  const selectedNodeId = useInvestigationStore((state) => state.selectedNodeId);
  const setSelected = useInvestigationStore((state) => state.setSelected);
  const view = useInvestigationStore((state) => state.view);
  if (!investigation) return null;

  return (
    <div className="flex min-h-dvh flex-col xl:h-dvh">
      <SavedExampleNote />
      <WorkspaceHeader />
      <div className="flex flex-1 flex-col xl:min-h-0 xl:flex-row xl:overflow-hidden">
      <aside className="flex flex-col gap-6 border-b border-border bg-wonderland/35 p-5 xl:w-72 xl:shrink-0 xl:overflow-y-auto xl:border-r xl:border-b-0">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs tracking-[0.18em] text-golden uppercase">The White Rabbit</p>
          <h1 className="font-heading text-3xl leading-snug break-words text-paper">{investigation.question}</h1>
        </div>

        <section className="flex flex-col gap-3" aria-labelledby="branch-list-heading">
          <h2 id="branch-list-heading" className="text-sm font-medium text-paper/80">
            Doors
          </h2>
          <ul className="flex flex-col gap-3" aria-live="polite">
            {investigation.branches.map((branch) => {
              const nodeId = branchNodeId(branch.id);
              const selected = selectedNodeId === nodeId;
              return (
              <li key={branch.id} className="flex flex-col gap-1">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className={`cursor-pointer rounded-md text-left text-sm leading-5 focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none ${selected ? "text-golden" : "text-paper"}`}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => setSelected(nodeId)}
                  >
                    {branch.title}
                  </button>
                  <StatusChip status={branch.status} />
                </div>
                <BranchActivity branchId={branch.id} title={branch.title} />
              </li>
              );
            })}
          </ul>
        </section>

        <CheshirePanel />

        {flowError ? (
          <p role="alert" className="text-sm text-destructive">
            {flowError}
          </p>
        ) : null}

        <div className="mt-auto pt-4">{goldenKey}</div>
      </aside>

      <main className="flex min-h-[50vh] min-w-0 flex-1 flex-col xl:min-h-0">
        <div className="min-h-[50vh] flex-1 xl:min-h-0">
          {view === "list" ? <ListView /> : <GraphCanvas />}
        </div>
      </main>

      {view === "list" ? (
        <aside className="border-t border-border bg-looking-glass/25 xl:w-80 xl:shrink-0 xl:overflow-y-auto xl:border-t-0 xl:border-l">
          <DiscoveryPanel />
        </aside>
      ) : null}
      </div>
    </div>
  );
}
