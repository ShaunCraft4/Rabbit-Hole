import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Back to the entrance to ask a new question. The current dream stays saved until a new
 * question is planned, so the browser's back button still returns to it.
 */
export function AskAnotherQuestion({ className }: { className?: string }) {
  return (
    <Button asChild variant="outline" size="sm" className={cn("w-fit cursor-pointer gap-1.5", className)}>
      <Link href="/">
        <ArrowLeft className="size-4" aria-hidden />
        Ask another question
      </Link>
    </Button>
  );
}
