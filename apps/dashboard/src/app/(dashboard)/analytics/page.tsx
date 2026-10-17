import { notFound } from "next/navigation";
import { AnalyticsPage } from "@/features/analytics/analytics-page";
import { today } from "@/lib/date";
import { getDeployment } from "@/lib/deployment";

export default async function Page() {
  const { publicDeployment, timezone, characters } = await getDeployment();
  if (publicDeployment) {
    notFound();
  }
  return <AnalyticsPage characters={characters} initialDate={today(timezone)} />;
}
