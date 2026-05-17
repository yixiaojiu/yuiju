import { Loader2 } from "lucide-react";

type LoadingIndicatorProps = {
  text?: string;
};

export const LoadingIndicator = ({ text = "加载中..." }: LoadingIndicatorProps) => {
  return (
    <div className="mt-2 inline-flex items-center gap-2 text-xs text-[#6f819a]">
      <Loader2 className="size-3.5 animate-spin" />
      <span>{text}</span>
    </div>
  );
};
