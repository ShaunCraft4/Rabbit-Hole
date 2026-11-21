"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { BROWSER_READ_LABEL, BROWSER_READ_TOOLTIP } from "./panels/copy";

export function BrowserReadBadge() {
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
