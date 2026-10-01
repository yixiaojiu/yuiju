import { House } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function HomePage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">主页</h1>
      </header>
      <Card className="rounded-2xl border-border/80 shadow-[0_8px_32px_rgba(21,33,54,0.04)]">
        <CardContent className="flex min-h-72 flex-col items-center justify-center gap-4 text-center sm:min-h-96">
          <div className="grid size-14 place-items-center rounded-2xl bg-accent text-muted-foreground">
            <House aria-hidden="true" className="size-6" />
          </div>
          <p className="text-sm text-muted-foreground">暂无内容</p>
        </CardContent>
      </Card>
    </div>
  );
}
