import { formatPublished, retrievalLabel, safeHttpUrl } from "@/components/panels/copy";
import type { Investigation, Report, Source } from "@/lib/types";

/** One key discovery, with the citation number of its source (first appearance order). */
export type CitedDiscovery = {
  index: number;
  claimId: string;
  summary: string;
  sourceNumber: number | null;
  sourceTitle: string | null;
  sourceDomain: string | null;
  sourceHref: string | null;
};

/** A source cited by at least one discovery. Numbering follows first appearance. */
export type EvidenceItem = {
  number: number;
  source: Source;
  href: string | null;
  dateLabel: string;
  discoveryIndexes: number[];
};

export type ReportViewModel = {
  discoveries: CitedDiscovery[];
  evidence: EvidenceItem[];
};

/**
 * Numbers sources by the order they first appear in key discoveries.
 * Two discoveries that share a source share a number.
 */
export function buildReportView(investigation: Investigation, report: Report): ReportViewModel {
  const claims = new Map(investigation.claims.map((claim) => [claim.id, claim]));
  const sources = new Map(investigation.sources.map((source) => [source.id, source]));
  const numberBySource = new Map<string, number>();
  const discoveries: CitedDiscovery[] = [];
  const evidence: EvidenceItem[] = [];

  for (let offset = 0; offset < report.keyDiscoveries.length; offset += 1) {
    const discovery = report.keyDiscoveries[offset];
    if (!discovery) continue;
    const index = offset + 1;
    const claim = claims.get(discovery.claimId);
    const source = claim ? sources.get(claim.sourceId) : undefined;
    let sourceNumber: number | null = null;

    if (source) {
      const existing = numberBySource.get(source.id);
      if (existing) {
        sourceNumber = existing;
        evidence[existing - 1]?.discoveryIndexes.push(index);
      } else {
        sourceNumber = evidence.length + 1;
        numberBySource.set(source.id, sourceNumber);
        evidence.push({
          number: sourceNumber,
          source,
          href: safeHttpUrl(source.url),
          dateLabel: source.publishedAt?.trim() ? formatPublished(source.publishedAt) : "No date",
          discoveryIndexes: [index],
        });
      }
    }

    discoveries.push({
      index,
      claimId: discovery.claimId,
      summary: discovery.summary,
      sourceNumber,
      sourceTitle: source?.title ?? null,
      sourceDomain: source?.domain ?? null,
      sourceHref: source ? safeHttpUrl(source.url) : null,
    });
  }

  return { discoveries, evidence };
}

/** `[1]` or `[[1]](url)`, which CommonMark renders as a link labeled [1]. */
function citationMarker(number: number, href: string | null): string {
  const label = `[${number}]`;
  if (!href) return label;
  return `[${label}](${href})`;
}

/** Plain Markdown of the report, built on the client from the view model. */
export function reportToMarkdown(
  question: string,
  report: Report,
  view: ReportViewModel,
  uncertaintyPrefix: (gapId: string | undefined) => string,
): string {
  const lines: string[] = [`# ${question.trim()}`, "", "## Direct answer", "", report.directAnswer.trim(), ""];

  lines.push("## Key discoveries", "");
  if (view.discoveries.length === 0) {
    lines.push("No key discoveries were written.", "");
  } else {
    for (const discovery of view.discoveries) {
      const marker =
        discovery.sourceNumber == null ? "" : ` ${citationMarker(discovery.sourceNumber, discovery.sourceHref)}`;
      lines.push(`${discovery.index}. ${discovery.summary.trim()}${marker}`);
    }
    lines.push("");
  }

  lines.push("## Connections that change the plan", "");
  if (report.planChangingConnections.length === 0) {
    lines.push("No accepted connection changes the plan.", "");
  } else {
    for (const connection of report.planChangingConnections) {
      lines.push(`- ${connection.text.trim()}`);
    }
    lines.push("");
  }

  lines.push("## What remains uncertain", "");
  if (report.uncertainties.length === 0) {
    lines.push("Nothing in this report is still marked uncertain.", "");
  } else {
    for (const item of report.uncertainties) {
      const prefix = uncertaintyPrefix(item.gapId);
      lines.push(`- ${prefix}${item.text.trim()}`);
    }
    lines.push("");
  }

  lines.push("## Next steps", "");
  for (const step of report.nextSteps) {
    lines.push(`- [ ] ${step.step.trim()}`);
    if (step.reason?.trim()) lines.push(`  ${step.reason.trim()}`);
  }
  lines.push("");

  lines.push("## Evidence", "");
  if (view.evidence.length === 0) {
    lines.push("No source was cited by the key discoveries.");
  } else {
    for (const item of view.evidence) {
      const cited =
        item.discoveryIndexes.length === 0
          ? "Cited by no discovery."
          : `Cited by ${item.discoveryIndexes.map((index) => `discovery ${index}`).join(", ")}.`;
      lines.push(
        `${item.number}. ${item.source.title.trim()} — \`${item.source.domain}\` — ${item.dateLabel} — ${retrievalLabel(item.source.retrievalStatus)}`,
      );
      if (item.href) lines.push(`   ${item.href}`);
      lines.push(`   ${cited}`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

/** Plain text for one finding, including its citation and source. */
export function findingToMarkdown(discovery: CitedDiscovery): string {
  const lines = [discovery.summary.trim()];
  if (discovery.sourceNumber != null) lines[0] = `${lines[0]} [${discovery.sourceNumber}]`;
  if (discovery.sourceTitle) lines.push("", discovery.sourceTitle);
  if (discovery.sourceDomain) lines.push(discovery.sourceDomain);
  if (discovery.sourceHref) lines.push(discovery.sourceHref);
  return `${lines.join("\n").trim()}\n`;
}
