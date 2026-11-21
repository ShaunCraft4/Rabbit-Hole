/**
 * buildNodePage: everything the UI shows after zooming into one skill-tree node (its "page"),
 * assembled from the investigation and the tree. Pure and client-safe; never touches page text
 * (client investigations only hold PublicSource, and SourceRef copies named fields only).
 */
import type { EvidenceStatus, GapKind, Investigation, Source } from "@/lib/types";

import { findingNodeId, gapNodeId, START_NODE_ID } from "./layout";
import type { NodePage, NodeRef, SkillNode, SkillTree, SourceRef } from "./types";

export const EVIDENCE_NOTES: Record<EvidenceStatus, string> = {
  corroborated: "Two or more different websites say the same thing.",
  single_source: "One page says this, and the quote was found word for word on that page.",
  conflicting: "Another finding disagrees with this one. Check both before relying on it.",
  outdated: "This may describe a past year or application cycle.",
  snippet_only: "Only the search result snippet could be read, not the full page.",
};

export const GAP_KIND_NOTES: Record<GapKind, string> = {
  missing: "Nothing found so far answers this.",
  conflict: "Findings disagree about this.",
  outdated: "The evidence for this may describe a past year or cycle.",
  weak: "This rests on thin evidence: a snippet, or a condition that could change the plan.",
};

const ref = (n: SkillNode): NodeRef => ({ id: n.id, kind: n.kind, label: n.label, color: n.color });

function sourceRef(s: Omit<Source, "text"> & { text?: unknown }): SourceRef {
  return {
    id: s.id,
    title: s.title,
    domain: s.domain,
    url: s.url,
    retrievalStatus: s.retrievalStatus,
    ...(s.retrievedVia ? { retrievedVia: s.retrievedVia } : {}),
    ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}),
  };
}

/** The page for `nodeId`, or null when the node is not in the tree (e.g. a dismissed gap). */
export function buildNodePage(investigation: Investigation, tree: SkillTree, nodeId: string): NodePage | null {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  if (!node) return null;
  const refOf = (id: string) => {
    const n = byId.get(id);
    return n ? ref(n) : null;
  };

  // Breadcrumbs, children and reading order.
  const trail: NodeRef[] = [];
  for (let cur: SkillNode | undefined = node; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    trail.unshift(ref(cur));
    if (trail.length > tree.nodes.length) break;
  }
  const order = [
    START_NODE_ID,
    ...tree.regions.flatMap((r) => r.nodeIds),
    ...tree.nodes.filter((n) => n.kind === "gap" && n.regionId === null).map((n) => n.id),
  ];
  const at = order.indexOf(nodeId);
  const base = {
    id: node.id,
    label: node.label,
    color: node.color,
    trail,
    parent: node.parentId ? refOf(node.parentId) : null,
    children: node.childIds.map(refOf).filter((r): r is NodeRef => r !== null),
    prev: at > 0 ? refOf(order[at - 1]) : null,
    next: at >= 0 && at < order.length - 1 ? refOf(order[at + 1]) : null,
  };

  const sourceById = new Map(investigation.sources.map((s) => [s.id, s]));
  const report = investigation.report;

  switch (node.kind) {
    case "start": {
      const findings = tree.nodes.filter((n) => n.kind === "finding").length;
      return {
        ...base,
        kind: "start",
        question: investigation.question,
        assumptions: investigation.assumptions,
        regions: tree.regions.map((r) => ({
          ...ref(byId.get(r.doorId)!),
          title: r.title,
          status: r.status,
          findingCount: r.findingCount,
          openGapCount: r.openGapCount,
        })),
        ...(report ? { directAnswer: report.directAnswer } : {}),
        stats: {
          findings,
          sources: investigation.sources.filter((s) => s.retrievalStatus !== "failed").length,
          openGaps: tree.nodes.filter((n) => n.kind === "gap" && n.status === "open").length,
          links: tree.trails.filter((t) => t.kind === "link").length,
          rejectedClaims: investigation.rejectedClaims,
        },
      };
    }

    case "door": {
      const branch = investigation.branches.find((b) => b.id === node.branchId)!;
      const region = tree.regions.find((r) => r.id === node.branchId)!;
      const members = region.nodeIds.map((id) => byId.get(id)!).filter((n) => n.id !== node.id);
      const evidence: Record<EvidenceStatus, number> = {
        corroborated: 0,
        single_source: 0,
        conflicting: 0,
        outdated: 0,
        snippet_only: 0,
      };
      const cites = new Map<string, number>();
      for (const m of members) {
        if (m.kind !== "finding") continue;
        evidence[m.evidenceStatus]++;
        cites.set(m.sourceId, (cites.get(m.sourceId) ?? 0) + 1);
      }
      const sources = [...cites.entries()]
        .sort((a, b) => b[1] - a[1])
        .flatMap(([id]) => {
          const s = sourceById.get(id);
          return s ? [sourceRef(s)] : [];
        });
      return {
        ...base,
        kind: "door",
        branchId: branch.id,
        title: branch.title,
        question: branch.question,
        queries: branch.queries,
        status: branch.status,
        findings: members.filter((m) => m.kind === "finding").map(ref),
        gaps: members.filter((m) => m.kind === "gap").map(ref),
        sources,
        evidence,
      };
    }

    case "finding": {
      const claim = investigation.claims.find((c) => c.id === node.claimId)!;
      const source = sourceById.get(claim.sourceId);
      const samePage = tree.nodes.filter((n) => n.kind === "finding" && n.sourceId === claim.sourceId && n.id !== node.id).map(ref);
      const planText = new Map(report?.planChangingConnections.map((p) => [p.connectionId, p.text]) ?? []);
      const links = investigation.connections.flatMap((c) => {
        const direction = c.from === claim.id ? "out" : c.to === claim.id ? "in" : null;
        if (!direction || c.from === c.to) return [];
        const other = refOf(findingNodeId(direction === "out" ? c.to : c.from));
        if (!other) return [];
        const text = planText.get(c.id);
        return [
          {
            connectionId: c.id,
            relationship: c.relationship,
            direction,
            other,
            explanation: c.explanation,
            accepted: c.accepted === true,
            ...(text ? { planChanging: text } : {}),
          } as const,
        ];
      });
      const gaps = investigation.gaps.flatMap((g) => {
        const n = g.claimIds.includes(claim.id) ? byId.get(gapNodeId(g.id)) : undefined;
        return n ? [{ ...ref(n), question: g.question, gapKind: g.kind }] : [];
      });
      const summary = report?.keyDiscoveries.find((d) => d.claimId === claim.id)?.summary;
      return {
        ...base,
        kind: "finding",
        claimId: claim.id,
        text: claim.text,
        excerpt: claim.excerpt,
        verified: claim.verified,
        evidenceStatus: claim.evidenceStatus,
        evidenceNote: EVIDENCE_NOTES[claim.evidenceStatus],
        ...(claim.dateMentioned ? { dateMentioned: claim.dateMentioned } : {}),
        source: source ? sourceRef(source) : null,
        ...(summary ? { keyDiscovery: summary } : {}),
        samePage,
        links,
        gaps,
      };
    }

    case "gap": {
      const gap = investigation.gaps.find((g) => g.id === node.gapId)!;
      const uncertainty = report?.uncertainties.find((u) => u.gapId === gap.id)?.text;
      return {
        ...base,
        kind: "gap",
        gapId: gap.id,
        question: gap.question,
        whyItMatters: gap.whyItMatters,
        gapKind: gap.kind,
        gapKindNote: GAP_KIND_NOTES[gap.kind],
        status: gap.status,
        ...(gap.suggestedQuery ? { suggestedQuery: gap.suggestedQuery } : {}),
        about: gap.claimIds.map((id) => refOf(findingNodeId(id))).filter((r): r is NodeRef => r !== null),
        ...(uncertainty ? { uncertainty } : {}),
      };
    }
  }
}
