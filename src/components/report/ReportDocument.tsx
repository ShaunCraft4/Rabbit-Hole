"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Lock } from "lucide-react";

import { BrowserReadBadge } from "@/components/BrowserReadBadge";
import { GAP_KIND_LABEL, retrievalLabel } from "@/components/panels/copy";
import { AskAnotherQuestion } from "@/components/AskAnotherQuestion";
import { DREAM } from "@/components/DreamScene";
import { Button } from "@/components/ui/button";
import { gapNodeId } from "@/lib/graph/build";
import { REGION_COLORS } from "@/lib/skilltree";
import type { Investigation, Report } from "@/lib/types";

import { DiscoveryCard } from "./DiscoveryCard";
import { buildReportView, findingToMarkdown, reportToMarkdown, type EvidenceItem } from "./markdown";

const DOWNLOAD_NAME = "golden-key.md";

type Notice = { tone: "ok" | "err"; text: string };

function nodeHref(nodeId: string): string {
  return `/dream?node=${encodeURIComponent(nodeId)}`;
}

function EvidenceCite({ item }: { item: EvidenceItem }) {
  if (item.discoveryIndexes.length === 0) {
    return <p className="text-sm text-paper/70">No discovery cites this source.</p>;
  }

  return (
    <p className="text-sm leading-6 text-paper/80">
      Cited by{" "}
      {item.discoveryIndexes.map((index, position) => {
        const last = position === item.discoveryIndexes.length - 1;
        const only = item.discoveryIndexes.length === 1;
        let separator = "";
        if (!only && position > 0) separator = last ? " and " : ", ";
        return (
          <span key={index}>
            {separator}
            <a
              href={`#discovery-${index}`}
              className="text-golden underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
            >
              discovery {index}
            </a>
            {last ? "." : null}
          </span>
        );
      })}
    </p>
  );
}

/** A section heading with an optional count and a one-line explanation under it. */
function SectionHeading({ id, title, count, note }: { id: string; title: string; count?: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={id} className="font-heading text-3xl text-paper">
          {title}
        </h2>
        {count ? <span className="font-mono text-xs tracking-[0.16em] text-golden/80 uppercase">{count}</span> : null}
      </div>
      {note ? <p className="text-sm leading-6 text-paper/65">{note}</p> : null}
    </div>
  );
}

const stagger = (index: number) => ({ animationDelay: `${Math.min(index, 8) * 70}ms` });

function NextSteps({ steps }: { steps: Report["nextSteps"] }) {
  const [done, setDone] = useState<Record<number, boolean>>({});
  const finished = steps.reduce((count, _, index) => count + (done[index] ? 1 : 0), 0);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="next-steps-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="next-steps-heading" className="font-heading text-3xl text-paper">
          Next steps
        </h2>
        <p className="text-sm text-paper/70">
          {finished} of {steps.length} done
        </p>
      </div>
      {steps.length === 0 ? (
        <p className="text-sm leading-6 text-paper/70">No next steps were written.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {steps.map((item, index) => {
            const id = `next-step-${index}`;
            const checked = done[index] === true;
            return (
              <li key={id}>
                <div
                  className={`flex items-start gap-3 rounded-xl border px-3 py-3 ${checked ? "border-golden/40 bg-wonderland/40" : "border-paper/15 bg-midnight/30"}`}
                >
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    className="mt-1 size-4 shrink-0 accent-golden"
                    onChange={() => setDone((current) => ({ ...current, [index]: !current[index] }))}
                  />
                  <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1">
                    <span className={`leading-6 break-words text-paper ${checked ? "line-through decoration-paper/50" : ""}`}>
                      {item.step}
                    </span>
                    {item.reason?.trim() ? (
                      <span className="text-sm leading-6 break-words text-paper/70">{item.reason}</span>
                    ) : null}
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ReportDocument({ investigation, report }: { investigation: Investigation; report: Report }) {
  const view = useMemo(() => buildReportView(investigation, report), [investigation, report]);
  const gaps = useMemo(() => new Map(investigation.gaps.map((gap) => [gap.id, gap])), [investigation.gaps]);
  const claims = useMemo(() => new Map(investigation.claims.map((claim) => [claim.id, claim])), [investigation.claims]);
  // Each door keeps the color its region has on the map (same order as the skill tree).
  const doors = useMemo(
    () =>
      new Map(
        investigation.branches.map((branch, index) => [
          branch.id,
          { title: branch.title, color: REGION_COLORS[index % REGION_COLORS.length] },
        ]),
      ),
    [investigation.branches],
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );

  function uncertaintyPrefix(gapId: string | undefined): string {
    if (!gapId) return "";
    const gap = gaps.get(gapId);
    return gap ? `${GAP_KIND_LABEL[gap.kind]}: ` : "";
  }

  function showNotice(next: Notice) {
    setNotice(next);
    if (timer.current != null) window.clearTimeout(timer.current);
    if (next.tone === "ok") {
      timer.current = window.setTimeout(() => setNotice(null), 2500);
    }
  }

  const markdown = () => reportToMarkdown(investigation.question, report, view, uncertaintyPrefix);

  async function copyText(text: string, success: string) {
    try {
      await navigator.clipboard.writeText(text);
      showNotice({ tone: "ok", text: success });
    } catch {
      showNotice({
        tone: "err",
        text: "Copying failed. Select the text and copy it manually.",
      });
    }
  }

  function download() {
    const blob = new Blob([markdown()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = DOWNLOAD_NAME;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-5 pt-4 pb-16">
      <div className="sticky top-0 z-20 -mx-5 flex flex-col gap-2 border-b border-border bg-midnight/92 px-5 py-3 backdrop-blur-md">
        <div className="flex flex-wrap gap-2">
          <AskAnotherQuestion />
          <Button asChild variant="outline" size="sm" className="cursor-pointer">
            <Link href="/dream" transitionTypes={[DREAM.sink]}>
              Back to map
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            className="cursor-pointer"
            onClick={() => void copyText(markdown(), "Copied the full report.")}
          >
            Copy full report
          </Button>
          <Button type="button" size="sm" variant="outline" className="cursor-pointer" onClick={download}>
            Download as .md
          </Button>
        </div>
        <p
          role="status"
          aria-live="polite"
          className={notice ? `text-sm ${notice.tone === "err" ? "text-destructive" : "text-golden"}` : "sr-only"}
        >
          {notice?.text ?? ""}
        </p>
      </div>

      <header className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-[0.18em] text-golden uppercase">Waking up</p>
        <h1 className="font-heading text-5xl text-paper">The Golden Key</h1>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="original-question-heading">
        <h2 id="original-question-heading" className="font-heading text-3xl text-paper">
          Original question
        </h2>
        <p className="font-heading text-2xl leading-snug break-words text-paper sm:text-3xl">{investigation.question}</p>
      </section>

      <section
        className="flex flex-col gap-4 rounded-2xl border border-golden/45 bg-wonderland/55 px-6 py-7 shadow-[0_0_48px_rgb(214_183_107/0.14)]"
        aria-labelledby="direct-answer-heading"
      >
        <h2 id="direct-answer-heading" className="font-heading text-3xl text-golden">
          Direct answer
        </h2>
        <p className="font-heading text-xl leading-snug break-words text-paper sm:text-2xl">{report.directAnswer}</p>
      </section>

      <section className="flex flex-col gap-5" aria-labelledby="discoveries-heading">
        <SectionHeading
          id="discoveries-heading"
          title="Key discoveries"
          count={view.discoveries.length ? `${view.discoveries.length} ${view.discoveries.length === 1 ? "finding" : "findings"}` : undefined}
          note="Each one rests on a quote found word for word on its source page."
        />
        {view.discoveries.length === 0 ? (
          <p className="text-sm leading-6 text-paper/70">The report has no key discoveries.</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {view.discoveries.map((discovery, order) => {
              const claim = claims.get(discovery.claimId);
              const door = claim ? doors.get(claim.branchId) : undefined;
              return (
                <DiscoveryCard
                  key={`${discovery.index}-${discovery.claimId}`}
                  discovery={discovery}
                  claim={claim}
                  doorTitle={door?.title ?? null}
                  color={door?.color ?? null}
                  order={order}
                  onCopy={() => void copyText(findingToMarkdown(discovery), "Copied this finding.")}
                />
              );
            })}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="connections-heading">
        <h2 id="connections-heading" className="font-heading text-3xl text-paper">
          Connections that change the plan
        </h2>
        {report.planChangingConnections.length === 0 ? (
          <p className="text-sm leading-6 text-paper/70">
            No accepted connection changes the plan. Accept a link on the map, then unlock the key again.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {report.planChangingConnections.map((connection) => (
              <li
                key={connection.connectionId}
                className="rounded-xl border border-paper/15 bg-midnight/30 px-4 py-3 text-base leading-7 break-words text-paper"
              >
                {connection.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-5" aria-labelledby="uncertain-heading">
        <SectionHeading
          id="uncertain-heading"
          title="What remains uncertain"
          note="Locked doors: what the evidence does not settle yet."
        />
        {report.uncertainties.length === 0 ? (
          <p className="text-sm leading-6 text-paper/70">Nothing in this report is still marked uncertain.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {report.uncertainties.map((item, index) => {
              const gap = item.gapId ? gaps.get(item.gapId) : undefined;
              return (
                <li
                  key={`uncertainty-${index}`}
                  style={stagger(index)}
                  className="dream-reveal flex items-start gap-3.5 rounded-2xl border border-dashed border-paper/22 bg-midnight/35 px-4 py-3.5 transition-[border-color,background-color] duration-500 hover:border-golden/40 hover:bg-wonderland/35"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-mystic-ink/45 bg-wonderland/60 text-mystic-ink"
                  >
                    <Lock className="size-3.5" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    {gap ? (
                      <span className="font-mono text-[10px] tracking-[0.16em] text-golden uppercase">
                        {GAP_KIND_LABEL[gap.kind]}
                      </span>
                    ) : null}
                    {gap ? (
                      <Link
                        href={nodeHref(gapNodeId(gap.id))}
                        transitionTypes={[DREAM.sink]}
                        className="rounded leading-7 break-words text-paper transition-colors duration-300 hover:text-golden focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
                      >
                        {item.text}
                      </Link>
                    ) : (
                      <p className="leading-7 break-words text-paper">{item.text}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <NextSteps key={report.nextSteps.map((step) => step.step).join("\n")} steps={report.nextSteps} />

      <section className="flex flex-col gap-5" aria-labelledby="evidence-heading">
        <SectionHeading
          id="evidence-heading"
          title="Evidence"
          count={view.evidence.length ? `${view.evidence.length} ${view.evidence.length === 1 ? "source" : "sources"}` : undefined}
          note="The pages the key discoveries were read from."
        />
        {view.evidence.length === 0 ? (
          <p className="text-sm leading-6 text-paper/70">No source was cited by the key discoveries.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {view.evidence.map((item, index) => {
              const failed = item.source.retrievalStatus === "failed";
              return (
                <li id={`source-${item.number}`} key={item.source.id} className="scroll-mt-28">
                  <article
                    style={stagger(index)}
                    className="dream-reveal flex items-start gap-4 rounded-2xl border border-paper/12 bg-midnight/35 px-4 py-4 transition-[border-color,background-color] duration-500 hover:border-golden/35 hover:bg-wonderland/30"
                  >
                    <span
                      aria-hidden
                      className="shrink-0 rounded-lg border border-golden/40 bg-midnight/60 px-2 py-1 font-mono text-sm text-golden"
                    >
                      {item.number}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                      <p className="leading-6 break-words text-paper">
                        <span className="sr-only">Source {item.number}: </span>
                        {item.source.title}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="rounded-full border border-paper/15 bg-midnight/40 px-2 py-0.5 font-mono break-all text-paper/75">
                          {item.source.domain}
                        </span>
                        <span className="rounded-full border border-paper/15 px-2 py-0.5 text-paper/70">{item.dateLabel}</span>
                        <span
                          className={`rounded-full border px-2 py-0.5 ${failed ? "border-destructive/45 text-destructive" : "border-paper/15 text-paper/70"}`}
                        >
                          {retrievalLabel(item.source.retrievalStatus)}
                        </span>
                        {item.source.retrievedVia === "browser" ? <BrowserReadBadge /> : null}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-paper/10 pt-2.5">
                        <EvidenceCite item={item} />
                        {item.href ? (
                          <a
                            href={item.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex shrink-0 items-center gap-1 rounded text-sm text-golden transition-colors duration-300 hover:text-paper focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
                          >
                            Open source
                            <ExternalLink className="size-3.5" aria-hidden />
                            <span className="sr-only"> {item.source.title} (opens in a new tab)</span>
                          </a>
                        ) : (
                          <p className="text-xs text-paper/70">No page link is available.</p>
                        )}
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
