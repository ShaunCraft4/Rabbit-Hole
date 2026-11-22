import Link from "next/link";
import type { CSSProperties } from "react";
import { Clock3, Copy, FileSearch, MapPin, Quote, Scale, ShieldCheck, type LucideIcon } from "lucide-react";

import { DREAM } from "@/components/DreamScene";
import { regionVar } from "@/components/graph/skilltree/colors";
import { evidenceBadge, evidenceExplanation } from "@/components/panels/copy";
import { Button } from "@/components/ui/button";
import { claimNodeId } from "@/lib/graph/build";
import type { RegionColor } from "@/lib/skilltree";
import type { Claim, EvidenceStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { CitedDiscovery } from "./markdown";

const EVIDENCE_LOOK: Record<EvidenceStatus, { icon: LucideIcon; className: string }> = {
  corroborated: { icon: ShieldCheck, className: "border-golden/55 bg-golden/10 text-golden" },
  conflicting: { icon: Scale, className: "border-amber-300/50 bg-amber-300/10 text-amber-200" },
  outdated: { icon: Clock3, className: "border-paper/25 bg-paper/5 text-paper/70" },
  snippet_only: { icon: FileSearch, className: "border-paper/25 bg-paper/5 text-paper/70" },
  single_source: { icon: Quote, className: "border-mystic-ink/30 bg-mystic/15 text-mystic-ink" },
};

export function EvidenceChip({ status }: { status: EvidenceStatus }) {
  const look = EVIDENCE_LOOK[status];
  const Icon = look.icon;
  return (
    <span
      title={evidenceExplanation(status)}
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", look.className)}
    >
      <Icon className="size-3" aria-hidden />
      {evidenceBadge(status)}
    </span>
  );
}

export function DoorChip({ title, color }: { title: string; color: RegionColor | null }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-paper/15 bg-midnight/40 px-2 py-0.5 text-[11px] text-paper/80">
      <span className="size-2 shrink-0 rounded-full" style={{ background: regionVar(color), boxShadow: `0 0 8px ${regionVar(color)}` }} aria-hidden />
      <span className="truncate">{title}</span>
    </span>
  );
}

/**
 * One key discovery as a card: its number, the door it came from (in that door's map color), how
 * strong the evidence is, the report's sentence, the verified quote it rests on, and its source.
 */
export function DiscoveryCard({
  discovery,
  claim,
  doorTitle,
  color,
  order,
  onCopy,
}: {
  discovery: CitedDiscovery;
  claim: Claim | undefined;
  doorTitle: string | null;
  color: RegionColor | null;
  /** Position in the list, for a gently staggered entrance. */
  order: number;
  onCopy: () => void;
}) {
  const accent = regionVar(color);
  const style = { "--card-accent": accent, animationDelay: `${Math.min(order, 8) * 70}ms` } as CSSProperties;

  return (
    <li id={`discovery-${discovery.index}`} className="scroll-mt-28">
      <article
        style={style}
        className="dream-reveal group/card relative overflow-hidden rounded-2xl border border-paper/12 bg-[linear-gradient(135deg,rgb(42_30_77/0.72),rgb(42_30_77/0.38)_55%,rgb(17_19_35/0.5))] py-4 pr-4 pl-5 shadow-[0_10px_30px_-20px_rgb(0_0_0/0.9)] transition-[border-color,box-shadow,translate] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-golden/35 hover:shadow-[0_0_40px_-16px_rgb(214_183_107/0.55)] motion-reduce:hover:translate-y-0"
      >
        {/* The door's color runs down the edge, like the region on the map. */}
        <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-(--card-accent) opacity-80" />
        <span
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-(--card-accent) opacity-[0.07] blur-2xl transition-opacity duration-500 group-hover/card:opacity-[0.14]"
        />

        <div className="relative flex items-start gap-4">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-golden/45 bg-midnight/60 font-heading text-xl text-golden lining-nums shadow-[0_0_18px_-6px_rgb(214_183_107/0.7)]"
          >
            {discovery.index}
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="sr-only">Discovery {discovery.index}.</span>
              {doorTitle ? <DoorChip title={doorTitle} color={color} /> : null}
              {claim ? <EvidenceChip status={claim.evidenceStatus} /> : null}
              {claim?.dateMentioned ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-paper/15 px-2 py-0.5 text-[11px] text-paper/70">
                  <Clock3 className="size-3" aria-hidden />
                  {claim.dateMentioned}
                </span>
              ) : null}
            </div>

            <p className="text-[1.05rem] leading-7 break-words text-paper">{discovery.summary}</p>

            {claim?.excerpt ? (
              <blockquote
                title={claim.excerpt}
                className="line-clamp-3 border-l-2 border-golden/40 pl-3 font-heading text-[1.05rem] leading-6 break-words text-paper/75 italic"
              >
                “{claim.excerpt}”
              </blockquote>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-paper/10 pt-3">
              {discovery.sourceNumber != null ? (
                <a
                  href={`#source-${discovery.sourceNumber}`}
                  className="inline-flex min-w-0 items-center gap-1.5 rounded text-xs text-paper/70 transition-colors duration-300 hover:text-golden focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
                >
                  <span className="font-mono text-golden">[{discovery.sourceNumber}]</span>
                  <span className="truncate">{discovery.sourceDomain ?? discovery.sourceTitle ?? "Source"}</span>
                  <span className="sr-only"> (jump to source {discovery.sourceNumber})</span>
                </a>
              ) : (
                <span className="text-xs text-paper/60">Source not recorded</span>
              )}
              <div className="flex shrink-0 items-center gap-1">
                <Button asChild variant="ghost" size="xs" className="cursor-pointer text-paper/75">
                  <Link href={`/dream?node=${encodeURIComponent(claimNodeId(discovery.claimId))}`} transitionTypes={[DREAM.sink]}>
                    <MapPin aria-hidden />
                    See on the map
                  </Link>
                </Button>
                <Button type="button" variant="ghost" size="xs" className="cursor-pointer text-paper/75" onClick={onCopy}>
                  <Copy aria-hidden />
                  Copy
                </Button>
              </div>
            </div>
          </div>
        </div>
      </article>
    </li>
  );
}
