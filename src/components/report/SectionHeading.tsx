/** A Golden Key section heading with an optional count and a one-line note under it. */
export function SectionHeading({ id, title, count, note }: { id: string; title: string; count?: string; note?: string }) {
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

/** A gently staggered entrance for list items (with the `dream-reveal` class). */
export const stagger = (index: number) => ({ animationDelay: `${Math.min(index, 8) * 70}ms` });
