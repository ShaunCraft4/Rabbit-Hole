import { GAP_KIND_LABEL, evidenceBadge, investigationCounts, retrievalLabel } from "@/components/panels/copy";
import { CITATION_STYLES, formatCitations, type CitationSource } from "@/lib/client/citations";
import type { Claim, Gap, Investigation, Report } from "@/lib/types";

import type { EvidenceView } from "./EvidenceSection";
import type { ReportViewModel } from "./markdown";

const longDate = (ms: number) => new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date(ms));

/**
 * The Golden Key as a document, for Save as PDF: laid out like a rendered Markdown report
 * (title, metadata, an at-a-glance table, sections with rules, numbered findings with their
 * verified quotes as blockquotes, a task list, and a reference list in the chosen citation style).
 * Hidden on screen; when printing, it replaces the web page entirely (see `.md-doc` in globals.css).
 */
export function PrintReport({
  investigation,
  report,
  view,
  claims,
  doors,
  gaps,
  citationView,
  accessedAt,
  generatedAt,
  title,
  savedExample,
}: {
  investigation: Investigation;
  report: Report;
  view: ReportViewModel;
  claims: Map<string, Claim>;
  doors: Map<string, { title: string }>;
  gaps: Map<string, Gap>;
  citationView: EvidenceView;
  accessedAt: number;
  generatedAt: number;
  title: string | undefined;
  savedExample: boolean;
}) {
  const counts = investigationCounts(investigation);
  const sources: CitationSource[] = view.evidence.map((item) => ({
    number: item.number,
    title: item.source.title,
    url: item.href,
    domain: item.source.domain,
    ...(item.source.publishedAt ? { publishedAt: item.source.publishedAt } : {}),
  }));
  const style = citationView === "cards" ? null : CITATION_STYLES[citationView];
  const citations = citationView === "cards" ? [] : formatCitations(citationView, sources, new Date(accessedAt));

  return (
    <article className="md-doc hidden print:block">
      <p className="md-eyebrow">Rabbit Hole · Research report</p>
      <h1>{investigation.question}</h1>
      <p className="md-meta">
        {title ? <>{title} · </> : null}
        {longDate(generatedAt)}
        {savedExample ? " · Saved example, recorded earlier" : null}
      </p>

      <table>
        <thead>
          <tr>
            <th>Pages read in full</th>
            <th>Quotes verified</th>
            <th>Claims rejected</th>
            <th>Open questions</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{counts.sourcesRead}</td>
            <td>{counts.verifiedClaims}</td>
            <td>{counts.rejectedClaims}</td>
            <td>{counts.openGaps}</td>
          </tr>
        </tbody>
      </table>

      <h2>Direct answer</h2>
      <p>{report.directAnswer}</p>

      {view.discoveries.length > 0 ? (
        <>
          <h2>Key discoveries</h2>
          <ol className="md-findings">
            {view.discoveries.map((discovery) => {
              const claim = claims.get(discovery.claimId);
              const door = claim ? doors.get(claim.branchId) : undefined;
              const meta = [
                door?.title,
                claim ? evidenceBadge(claim.evidenceStatus) : null,
                claim?.dateMentioned ? `mentions ${claim.dateMentioned}` : null,
              ].filter(Boolean);
              return (
                <li key={`${discovery.index}-${discovery.claimId}`}>
                  <p>
                    <strong>{discovery.summary}</strong>
                    {discovery.sourceNumber != null ? <span className="md-ref"> [{discovery.sourceNumber}]</span> : null}
                  </p>
                  {claim?.excerpt ? <blockquote>“{claim.excerpt}”</blockquote> : null}
                  {meta.length ? <p className="md-note">{meta.join(" · ")}</p> : null}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}

      {report.planChangingConnections.length > 0 ? (
        <>
          <h2>Connections that change the plan</h2>
          <ul>
            {report.planChangingConnections.map((connection) => (
              <li key={connection.connectionId}>{connection.text}</li>
            ))}
          </ul>
        </>
      ) : null}

      {report.uncertainties.length > 0 ? (
        <>
          <h2>What remains uncertain</h2>
          <ul>
            {report.uncertainties.map((item, index) => {
              const gap = item.gapId ? gaps.get(item.gapId) : undefined;
              return (
                <li key={`u-${index}`}>
                  {gap ? <strong>{GAP_KIND_LABEL[gap.kind]}: </strong> : null}
                  {item.text}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {report.nextSteps.length > 0 ? (
        <>
          <h2>Next steps</h2>
          <ul className="md-tasks">
            {report.nextSteps.map((step, index) => (
              <li key={`s-${index}`}>
                <span className="md-box" aria-hidden />
                <div>
                  <p>{step.step}</p>
                  {step.reason?.trim() ? <p className="md-note">{step.reason}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {view.evidence.length > 0 ? (
        style ? (
          <>
            <h2>{style.listTitle}</h2>
            <p className="md-meta">{style.edition}</p>
            <div className="md-refs">
              {citations.map((citation) => (
                <p key={citation.number}>
                  {citation.segments.map((segment, i) => (segment.italic ? <i key={i}>{segment.text}</i> : <span key={i}>{segment.text}</span>))}
                </p>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2>Sources</h2>
            <ol className="md-sources">
              {view.evidence.map((item) => (
                <li key={item.source.id} value={item.number}>
                  <p>
                    <strong>{item.source.title}</strong> · <code>{item.source.domain}</code>
                  </p>
                  <p className="md-note">
                    {item.dateLabel} · {retrievalLabel(item.source.retrievalStatus)}
                    {item.href ? <> · {item.href}</> : null}
                  </p>
                </li>
              ))}
            </ol>
          </>
        )
      ) : null}

      <hr />
      <p className="md-footer">
        Generated by Rabbit Hole on {longDate(generatedAt)}. Every key discovery rests on a quote that was found word for word on its
        source page; claims whose quotes could not be verified were discarded. Pages were read on {longDate(accessedAt)}.
      </p>
    </article>
  );
}
