"use client";

import { cn } from "@yuiju/shared/ui/utils";

/** 互斥且选项较少的切换；选中即生效，不经过提交。 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="inline-flex max-w-full min-w-0 shrink-0 overflow-x-auto rounded-lg border bg-card p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-8 shrink-0 rounded-md px-3 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            value === option.value
              ? "bg-accent font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
