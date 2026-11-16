import { cn } from "@yuiju/shared/ui/utils";
import { Search } from "lucide-react";
import type { ComponentProps } from "react";

/** 筛选栏中的文本输入；何时生效由调用方决定（回车提交或即时过滤）。 */
export function SearchInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        className="h-9 w-full min-w-0 rounded-lg border bg-card pr-3 pl-8 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        {...props}
      />
    </div>
  );
}
