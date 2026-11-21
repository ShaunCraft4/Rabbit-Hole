"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Connection } from "@/lib/types";
import { useInvestigationStore } from "@/stores/investigation";

import { relationshipLabel } from "./copy";

export function ConnectionsPanel({
  claimId,
  hideWhenEmpty = false,
}: {
  claimId?: string;
  hideWhenEmpty?: boolean;
}) {
  const investigation = useInvestigationStore((state) => state.investigation);
  const acceptConnection = useInvestigationStore((state) => state.acceptConnection);
  const dismissConnection = useInvestigationStore((state) => state.dismissConnection);

  if (!investigation) return null;

  const connections = investigation.connections
    .filter((connection) => !claimId || connection.from === claimId || connection.to === claimId)
    .slice()
    .sort((a, b) => Number(Boolean(a.accepted)) - Number(Boolean(b.accepted)));

  if (connections.length === 0 && hideWhenEmpty) return null;

  const heading = claimId ? "Related connections" : "The Mad Hatter found a connection";

  return (
    <section className="flex flex-col gap-3" aria-labelledby={claimId ? "related-connections-heading" : "connections-heading"}>
      <h3 id={claimId ? "related-connections-heading" : "connections-heading"} className="font-heading text-2xl text-paper">
        {heading}
      </h3>
      {connections.length === 0 ? (
        <p className="text-sm leading-6 text-paper/70">
          {claimId ? "No connection touches this finding yet." : "No connection has been proposed yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {connections.map((connection) => (
            <li key={connection.id}>
              <ConnectionCard
                connection={connection}
                fromText={claimText(investigation.claims, connection.from)}
                toText={claimText(investigation.claims, connection.to)}
                onAccept={() => acceptConnection(connection.id)}
                onDismiss={() => dismissConnection(connection.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function claimText(claims: { id: string; text: string }[], id: string): string {
  return claims.find((claim) => claim.id === id)?.text ?? "A finding that is no longer in this dream";
}

function ConnectionCard({
  connection,
  fromText,
  toText,
  onAccept,
  onDismiss,
}: {
  connection: Connection;
  fromText: string;
  toText: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const accepted = connection.accepted === true;
  const relation = relationshipLabel(connection.relationship);

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-paper/15 bg-midnight/35 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-golden/50 text-golden">
          {relation}
        </Badge>
        {accepted ? (
          <Badge variant="outline" className="border-golden text-golden">
            Accepted
          </Badge>
        ) : (
          <Badge variant="outline" className="border-paper/30 text-paper/75">
            Suggested
          </Badge>
        )}
      </div>
      <p className="line-clamp-3 text-sm leading-6 break-words text-paper">{fromText}</p>
      <p className="line-clamp-3 text-sm leading-6 break-words text-paper/80">{toText}</p>
      <p className="text-sm leading-6 break-words whitespace-pre-wrap text-paper/75">{connection.explanation}</p>
      <div className="flex flex-wrap gap-2">
        {accepted ? null : (
          <Button type="button" size="sm" className="cursor-pointer" onClick={onAccept}>
            Accept
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" className="cursor-pointer" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </article>
  );
}
