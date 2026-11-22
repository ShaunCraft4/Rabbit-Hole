import { GAP_KIND_LABEL, evidenceBadge, investigationCounts, retrievalLabel } from "@/components/panels/copy";
import { CITATION_STYLES, formatCitations, type CitationSource } from "@/lib/client/citations";
import type { Claim, EvidenceStatus, Gap, Investigation, Report } from "@/lib/types";

import type { EvidenceView } from "./EvidenceSection";
import type { CitedDiscovery, ReportViewModel } from "./markdown";

const longDate = (ms: number) => new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date(ms));

const STRENGTH_CLASS: Record<EvidenceStatus, string> = {
  corroborated: "rep-tag rep-tag-strong",
  conflicting: "rep-tag rep-tag-warn",
  outdated: "rep-tag rep-tag-warn",
  snippet_only: "rep-tag",
  single_source: "rep-tag",
};

type Group = { title: string; items: { discovery: CitedDiscovery; claim: Claim | undefined }[] };

/** Key discoveries grouped by the door (topic) they came from, in the plan's door order. */
function groupByDoor(
  discoveries: CitedDiscovery[],
  claims: Map<string, Claim>,
  doors: Map<string, { title: string }>,
): Group[] {
  const order = [...doors.keys()];
  const groups = new Map<string, Group>();
  for (const discovery of discoveries) {
    const claim = claims.get(discovery.claimId);
    const key = claim && doors.has(claim.branchId) ? claim.branchId : "_other";
    const title = key === "_other" ? "Other findings" : doors.get(key)!.title;
    if (!groups.has(key)) groups.set(key, { title, items: [] });
    groups.get(key)!.items.push({ discovery, claim });
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "_other" ? 1 : b === "_other" ? -1 : order.indexOf(a) - order.indexOf(b)))
    .map(([, group]) => group);
}

/**
 * The Golden Key as a research brief, for Save as PDF. Organized for a person reading it:
 * page 1 is the takeaway (short answer, headline numbers, what to do next); then the findings
 * grouped by topic with their evidence; then what to watch out for; then the sources in the
 * citation style chosen on screen. Hidden on screen; replaces the page when printing.
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
  const groups = groupByDoor(view.discoveries, claims, doors);
  const sources: CitationSource[] = view.evidence.map((item) => ({
    number: item.number,
    title: item.source.title,
    url: item.href,
    domain: item.source.domain,
    ...(item.source.publishedAt ? { publishedAt: item.source.publishedAt } : {}),
  }));
  const style = citationView === "cards" ? null : CITATION_STYLES[citationView];
  const citations = citationView === "cards" ? [] : formatCitations(citationView, sources, new Date(accessedAt));
  const hasWatch = report.planChangingConnections.length > 0 || report.uncertainties.length > 0;
  let section = 0;

  return (
    <article className="rep hidden print:block">
      {/* ---------- Page 1: the takeaway ---------- */}
      <header className="rep-head">
        <div className="rep-brand">
          <span>Rabbit Hole · Research brief</span>
          <span>{longDate(generatedAt)}</span>
        </div>
        <h1 className={title ? undefined : "rep-h1-long"}>{title ?? investigation.question}</h1>
        {title ? <p className="rep-question">{investigation.question}</p> : null}
        {savedExample ? <p className="rep-flag">Saved example: these results were recorded earlier, not searched just now.</p> : null}
      </header>

      <section className="rep-answer">
        <p className="rep-kicker">The short answer</p>
        <p>{report.directAnswer}</p>
      </section>

      <div className="rep-stats">
        <div>
          <strong>{counts.sourcesRead}</strong>
          <span>pages read in full</span>
        </div>
        <div>
          <strong>{counts.verifiedClaims}</strong>
          <span>quotes verified word for word</span>
        </div>
        <div>
          <strong>{counts.rejectedClaims}</strong>
          <span>claims thrown out as unverifiable</span>
        </div>
        <div>
          <strong>{counts.openGaps}</strong>
          <span>questions still open</span>
        </div>
      </div>

      {report.nextSteps.length > 0 ? (
        <section className="rep-section">
          <h2>
            <span className="rep-num">{++section}</span>What to do next
          </h2>
          <ol className="rep-steps">
            {report.nextSteps.map((step, index) => (
              <li key={`step-${index}`}>
                <span className="rep-box" aria-hidden />
                <span className="rep-step-num">{index + 1}</span>
                <div>
                  <p className="rep-step">{step.step}</p>
                  {step.reason?.trim() ? <p className="rep-why">{step.reason}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* ---------- What we found, by topic ---------- */}
      {groups.length > 0 ? (
        <section className="rep-section">
          <h2>
            <span className="rep-num">{++section}</span>What we found
          </h2>
          <p className="rep-intro">
            {view.discoveries.length} key {view.discoveries.length === 1 ? "finding" : "findings"}, grouped by topic. Each one rests on a quote found
            word for word on its source page; the number in brackets points to the source list at the end.
          </p>
          {groups.map((group) => (
            <div key={group.title} className="rep-group">
              <h3>{group.title}</h3>
              <ul className="rep-findings">
                {group.items.map(({ discovery, claim }) => (
                  <li key={`${discovery.index}-${discovery.claimId}`}>
                    <p className="rep-finding">
                      {discovery.summary}
                      {discovery.sourceNumber != null ? <span className="rep-cite"> [{discovery.sourceNumber}]</span> : null}
                    </p>
                    <p className="rep-meta">
                      {claim ? <span className={STRENGTH_CLASS[claim.evidenceStatus]}>{evidenceBadge(claim.evidenceStatus)}</span> : null}
                      {claim?.dateMentioned ? <span className="rep-tag">{claim.dateMentioned}</span> : null}
                      {discovery.sourceDomain ? <span className="rep-domain">{discovery.sourceDomain}</span> : null}
                    </p>
                    {claim?.excerpt ? <p className="rep-quote">“{claim.excerpt}”</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {/* ---------- Watch out for ---------- */}
      {hasWatch ? (
        <section className="rep-section">
          <h2>
            <span className="rep-num">{++section}</span>Watch out for
          </h2>
          {report.planChangingConnections.length > 0 ? (
            <div className="rep-group">
              <h3>Links that change the plan</h3>
              <ul className="rep-list">
                {report.planChangingConnections.map((connection) => (
                  <li key={connection.connectionId}>{connection.text}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {report.uncertainties.length > 0 ? (
            <div className="rep-group">
              <h3>Still uncertain</h3>
              <ul className="rep-open">
                {report.uncertainties.map((item, index) => {
                  const gap = item.gapId ? gaps.get(item.gapId) : undefined;
                  return (
                    <li key={`open-${index}`}>
                      <span className="rep-tag rep-tag-open">{gap ? GAP_KIND_LABEL[gap.kind] : "Open"}</span>
                      <p>{item.text}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ---------- Sources ---------- */}
      {view.evidence.length > 0 ? (
        <section className="rep-section">
          <h2>
            <span className="rep-num">{++section}</span>Sources
          </h2>
          {style ? (
            <>
              <p className="rep-intro">
                {style.listTitle}, {style.edition}.
              </p>
              <div className="rep-refs">
                {citations.map((citation) => (
                  <div key={citation.number} className="rep-ref">
                    {citationView === "ieee" ? null : <span className="rep-ref-num">[{citation.number}]</span>}
                    <p>
                      {citation.segments.map((segment, i) =>
                        segment.italic ? <i key={i}>{segment.text}</i> : <span key={i}>{segment.text}</span>,
                      )}
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rep-refs">
              {view.evidence.map((item) => (
                <div key={item.source.id} className="rep-ref">
                  <span className="rep-ref-num">[{item.number}]</span>
                  <div>
                    <p className="rep-source-title">{item.source.title}</p>
                    <p className="rep-why">
                      {item.source.domain} · {item.dateLabel} · {retrievalLabel(item.source.retrievalStatus)}
                    </p>
                    {item.href ? <p className="rep-url">{item.href}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <footer className="rep-foot">
        <p>
          <strong>How this brief was made.</strong> Rabbit Hole planned the research, read {counts.sourcesRead}{" "}
          {counts.sourcesRead === 1 ? "page" : "pages"} on {longDate(accessedAt)}, and kept only claims whose supporting quote was found
          word for word on the page; {counts.rejectedClaims} {counts.rejectedClaims === 1 ? "claim was" : "claims were"} discarded. Check
          deadlines and amounts with the offices named above before acting.
        </p>
      </footer>
    </article>
  );
}
