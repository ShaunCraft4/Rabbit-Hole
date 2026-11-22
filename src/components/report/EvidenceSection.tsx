"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { BrowserReadBadge } from "@/components/BrowserReadBadge";
import { retrievalLabel } from "@/components/panels/copy";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CITATION_STYLE_ORDER,
  CITATION_STYLES,
  formatCitations,
  type Citation,
  type CitationSource,
  type CitationStyle,
} from "@/lib/client/citations";

import type { EvidenceItem } from "./markdown";
import { SectionHeading, stagger } from "./SectionHeading";

export type EvidenceView = "cards" | CitationStyle;
type View = EvidenceView;

const VIEW_KEY = "rabbit-hole.citation-style";
const VIEWS: View[] = ["cards", ...CITATION_STYLE_ORDER];

/** Copies text with an HTML twin (rich paste keeps italics and hanging indents). */
export type RichCopy = (text: string, html: string, success: string) => Promise<boolean>;

export function readEvidenceView(): View {
  try {
    const stored = window.localStorage.getItem(VIEW_KEY);
    return VIEWS.includes(stored as View) ? (stored as View) : "cards";
  } catch {
    return "cards";
  }
}

export function saveEvidenceView(view: View) {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Remembering the choice is a convenience; the page works without it.
  }
}

/** A hanging-indent paragraph, as reference lists are laid out (0.5 in, like Word and Docs). */
const hangingParagraph = (html: string) => `<p style="margin:0 0 12pt 0;padding-left:0.5in;text-indent:-0.5in;">${html}</p>`;

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

function EvidenceCards({ evidence }: { evidence: EvidenceItem[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {evidence.map((item, index) => {
        const failed = item.source.retrievalStatus === "failed";
        return (
          <li id={`source-${item.number}`} key={item.source.id} className="scroll-mt-28">
            <article
              style={stagger(index)}
              className="dream-reveal flex items-start gap-4 rounded-2xl border border-paper/12 bg-midnight/35 px-4 py-4 transition-[border-color,background-color] duration-500 hover:border-golden/35 hover:bg-wonderland/30"
            >
              <span aria-hidden className="shrink-0 rounded-lg border border-golden/40 bg-midnight/60 px-2 py-1 font-mono text-sm text-golden">
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
                  {item.href ? <span className="hidden text-xs break-all print:inline">{item.href}</span> : null}
                  {item.href ? (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded text-sm text-golden print:hidden transition-colors duration-300 hover:text-paper focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
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
  );
}

function CitationList({
  style,
  citations,
  accessedLabel,
  onCopy,
}: {
  style: CitationStyle;
  citations: Citation[];
  accessedLabel: string;
  onCopy: RichCopy;
}) {
  const info = CITATION_STYLES[style];
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  async function copy(key: string, text: string, html: string, success: string) {
    if (!(await onCopy(text, html, success))) return;
    setCopied(key);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 1600);
  }

  const allText = citations.map((c) => c.text).join("\n\n");
  const allHtml = citations.map((c) => hangingParagraph(c.html)).join("");

  return (
    <div className="dream-swap flex flex-col gap-4 rounded-2xl border border-paper/12 bg-[linear-gradient(160deg,rgb(42_30_77/0.6),rgb(17_19_35/0.55))] p-5 shadow-[0_10px_30px_-20px_rgb(0_0_0/0.9)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-heading text-2xl text-paper">{info.listTitle}</h3>
          <p className="font-mono text-[11px] tracking-[0.14em] text-golden/80 uppercase">{info.edition}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="cursor-pointer gap-1.5 print:hidden"
          onClick={() => void copy("all", allText, allHtml, `Copied the ${info.label} ${info.listTitle.toLowerCase()}.`)}
        >
          {copied === "all" ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied === "all" ? "Copied" : "Copy all"}
        </Button>
      </div>

      <ol className="flex flex-col gap-1" aria-label={`${info.listTitle}, ${info.edition}`}>
        {citations.map((citation, index) => {
          const key = String(citation.number);
          return (
            <li
              key={citation.number}
              id={`source-${citation.number}`}
              style={stagger(index)}
              className="dream-reveal group/cite flex scroll-mt-28 items-start gap-3 rounded-xl px-2 py-2.5 transition-colors duration-300 hover:bg-paper/5"
            >
              {style === "ieee" ? null : (
                <span className="mt-1 w-7 shrink-0 font-mono text-[11px] text-golden/70" title={`Source ${citation.number} in this report`}>
                  [{citation.number}]
                </span>
              )}
              <p className="min-w-0 flex-1 pl-8 -indent-8 font-heading text-lg leading-7 text-paper lining-nums [overflow-wrap:anywhere] select-text">
                {citation.segments.map((segment, i) => (segment.italic ? <i key={i}>{segment.text}</i> : <span key={i}>{segment.text}</span>))}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="mt-1 shrink-0 cursor-pointer text-paper/60 opacity-70 print:hidden transition-opacity group-hover/cite:opacity-100"
                aria-label={`Copy the ${info.label} citation for source ${citation.number}`}
                onClick={() => void copy(key, citation.text, hangingParagraph(citation.html), `Copied the ${info.label} citation.`)}
              >
                {copied === key ? <Check aria-hidden className="text-golden" /> : <Copy aria-hidden />}
              </Button>
            </li>
          );
        })}
      </ol>

      <p className="border-t border-paper/10 pt-3 text-xs leading-5 text-paper/60 print:hidden">
        {info.rules} Access dates are {accessedLabel}, when this dream was researched. Pages rarely name an author, so each entry
        follows its style&apos;s no-author rule; where a page names no website, its web address stands in.
      </p>
    </div>
  );
}

/**
 * The Golden Key's evidence: the source cards (default), or the same sources as a reference list in
 * MLA, APA, Chicago, Harvard or IEEE, each copyable. The chosen format is remembered on this device.
 */
export function EvidenceSection({
  evidence,
  accessedAt,
  onCopy,
  view,
  onViewChange,
}: {
  evidence: EvidenceItem[];
  /** When the pages were read (ms); access/retrieval dates use this day. */
  accessedAt: number;
  onCopy: RichCopy;
  /** The chosen format (kept by ReportDocument, which also prints the references in it). */
  view: EvidenceView;
  onViewChange: (view: EvidenceView) => void;
}) {
  const accessed = useMemo(() => new Date(accessedAt), [accessedAt]);
  const sources = useMemo<CitationSource[]>(
    () =>
      evidence.map((item) => ({
        number: item.number,
        title: item.source.title,
        url: item.href,
        domain: item.source.domain,
        ...(item.source.publishedAt ? { publishedAt: item.source.publishedAt } : {}),
      })),
    [evidence],
  );
  const accessedLabel = new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(accessed);

  return (
    <section className="flex flex-col gap-5" aria-labelledby="evidence-heading">
      <SectionHeading
        id="evidence-heading"
        title="Evidence"
        count={evidence.length ? `${evidence.length} ${evidence.length === 1 ? "source" : "sources"}` : undefined}
        note="The pages the key discoveries were read from. View them as cards, or as a reference list in your citation style."
      />
      {evidence.length === 0 ? (
        <p className="text-sm leading-6 text-paper/70">No source was cited by the key discoveries.</p>
      ) : (
        <Tabs
          value={view}
          onValueChange={(next) => {
            onViewChange(next as View);
          }}
          className="gap-4"
        >
          <TabsList
            aria-label="Evidence format"
            className="h-auto w-full flex-wrap justify-start gap-1 rounded-xl border border-paper/12 bg-midnight/45 p-1 group-data-horizontal/tabs:h-auto sm:w-fit print:hidden"
          >
            {VIEWS.map((option) => (
              <TabsTrigger
                key={option}
                value={option}
                className="h-8 flex-none cursor-pointer rounded-lg px-3 text-[13px] text-paper/70 transition-[color,background-color,box-shadow,border-color] duration-300 hover:text-paper data-active:border-golden data-active:bg-golden data-active:text-midnight data-active:shadow-[0_0_18px_-4px_rgb(214_183_107/0.7)] dark:text-paper/70 dark:hover:text-paper dark:data-active:border-golden dark:data-active:bg-golden dark:data-active:text-midnight"
              >
                {option === "cards" ? "Cards" : CITATION_STYLES[option].label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="cards">
            <EvidenceCards evidence={evidence} />
          </TabsContent>
          {CITATION_STYLE_ORDER.map((style) => (
            <TabsContent key={style} value={style}>
              <CitationList style={style} citations={formatCitations(style, sources, accessed)} accessedLabel={accessedLabel} onCopy={onCopy} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </section>
  );
}
