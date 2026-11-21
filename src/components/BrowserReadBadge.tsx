"use client";

import { Globe } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { BROWSER_READ_LABEL, BROWSER_READ_TOOLTIP } from "./panels/copy";

export function BrowserReadBadge({ iconOnly = false }: { iconOnly?: boolean }) {
  if (iconOnly) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="nopan nodrag inline-flex size-3.5 cursor-pointer items-center justify-center rounded-full bg-midnight text-paper ring-1 ring-mystic focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
            aria-label={BROWSER_READ_LABEL}
            onClick={(event) => event.stopPropagation()}
          >
            <Globe className="size-2.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6} className="max-w-64 text-left text-balance">
          {BROWSER_READ_TOOLTIP}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          tabIndex={0}
          className="h-auto max-w-full cursor-help border-mystic text-paper whitespace-normal focus-visible:ring-golden"
        >
          {BROWSER_READ_LABEL}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-64 text-left text-balance">
        {BROWSER_READ_TOOLTIP}
      </TooltipContent>
    </Tooltip>
  );
}
