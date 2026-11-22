"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError } from "@/lib/client/api";
import { runPlan } from "@/lib/client/runner";
import { InvestigationSchema, LIMITS } from "@/lib/contracts";
import { mockInvestigation } from "@/fixtures";
import { useInvestigationStore } from "@/stores/investigation";

const EXAMPLES = [
  "How can I get funding for a student organization event at UC Riverside?",
  "What do I need to land an AI research position as a sophomore?",
  "How do I get funding to study abroad as a UCR undergraduate?",
] as const;

const FALL_MS = 720;

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function motionReduced(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function EntrancePage() {
  const router = useRouter();
  const loadInvestigation = useInvestigationStore((state) => state.loadInvestigation);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const busy = useRef(false);
  const [question, setQuestion] = useState("");
  const [falling, setFalling] = useState(false);
  const [working, setWorking] = useState<"plan" | "saved" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "The entrance · Rabbit Hole";
  }, []);

  // With Cache Components, Next keeps this page alive (hidden) after we fall to /dream, so its
  // state survives. Reset the one-time fall when the page is hidden; otherwise "Ask another
  // question" brings back an entrance that is still faded out, with its buttons disabled.
  useLayoutEffect(() => {
    return () => {
      busy.current = false;
      setFalling(false);
      setWorking(null);
      setError(null);
      setQuestion("");
    };
  }, []);

  async function fallToDream() {
    if (motionReduced()) {
      router.push("/dream");
      return;
    }
    setFalling(true);
    await new Promise((resolve) => setTimeout(resolve, FALL_MS));
    router.push("/dream");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const dream = question.trim();
    if (!dream || busy.current) return;
    busy.current = true;
    setWorking("plan");
    setError(null);
    try {
      await runPlan(dream);
      await fallToDream();
    } catch (caught) {
      setFalling(false);
      const message = errorMessage(caught, "The rabbit hole didn't open. Try again in a moment.");
      setError(message);
      toast.error(message);
      busy.current = false;
      setWorking(null);
    }
  }

  async function onLoadSaved() {
    if (busy.current) return;
    busy.current = true;
    setWorking("saved");
    setError(null);
    try {
      let investigation = mockInvestigation;
      try {
        const response = await fetch("/demo-investigation.json", { cache: "no-store" });
        if (!response.ok) throw new Error("missing");
        investigation = InvestigationSchema.parse(await response.json());
      } catch {
        investigation = mockInvestigation;
      }
      loadInvestigation(investigation);
      await fallToDream();
    } catch (caught) {
      setFalling(false);
      const message = errorMessage(caught, "The saved example could not be opened.");
      setError(message);
      toast.error(message);
      busy.current = false;
      setWorking(null);
    }
  }

  return (
    <motion.main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-5 py-16"
      initial={false}
      animate={falling ? { y: "42vh", scale: 0.94, opacity: 0 } : { y: 0, scale: 1, opacity: 1 }}
      transition={{ duration: falling ? FALL_MS / 1000 : 0, ease: [0.4, 0, 1, 1] }}
      style={{ transformOrigin: "center top" }}
    >
      <header className="flex flex-col gap-3 text-center">
        <p className="font-mono text-xs tracking-[0.22em] text-golden uppercase">Rabbit Hole</p>
        <h1 className="font-heading text-5xl leading-tight text-paper sm:text-6xl">What dream are you chasing?</h1>
        <p className="text-base text-paper/75 sm:text-lg">
          Describe a goal, plan, or question. We&apos;ll find the way down.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="dream" className="text-sm text-paper/80">
            Your dream
          </label>
          <Textarea
            ref={textareaRef}
            id="dream"
            name="dream"
            value={question}
            maxLength={LIMITS.questionChars}
            placeholder="A goal, a plan, or a question you can't quite see clearly yet."
            disabled={working !== null}
            className="min-h-32 bg-wonderland/40 text-base md:text-base"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <p className="font-mono text-xs text-paper/75">
            {question.length} / {LIMITS.questionChars}
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          size="lg"
          className="h-12 cursor-pointer px-6 text-base"
          disabled={working !== null || question.trim().length === 0}
        >
          {working === "plan" ? "Falling…" : "Fall down the rabbit hole"}
        </Button>
      </form>

      <section className="flex flex-col gap-3" aria-labelledby="examples-heading">
        <h2 id="examples-heading" className="text-sm text-paper/70">
          Or try one of these
        </h2>
        <ul className="flex flex-col gap-2">
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button
                type="button"
                className="w-full cursor-pointer rounded-xl border border-paper/15 bg-wonderland/40 px-4 py-3 text-left text-sm leading-6 text-paper transition hover:border-golden/60 focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
                onClick={() => {
                  setQuestion(example);
                  textareaRef.current?.focus();
                }}
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          className="cursor-pointer text-sm text-paper/70 underline-offset-4 hover:text-paper hover:underline focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none disabled:opacity-50"
          disabled={working !== null}
          onClick={() => void onLoadSaved()}
        >
          {working === "saved" ? "Opening the example…" : "Load saved dream"}
        </button>
        <p className="text-xs text-paper/75">A saved example, not a live search.</p>
      </div>
    </motion.main>
  );
}
