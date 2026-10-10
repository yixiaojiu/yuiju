import { notFound } from "next/navigation";
import { AnalyticsPage } from "@/features/analytics/analytics-page";
import { today } from "@/lib/date";
import { getDeployment } from "@/lib/deployment";

export default async function Page() {
  const { publicDeployment, timezone } = await getDeployment();
  if (publicDeployment) {
    notFound();
  }
  return <AnalyticsPage initialDate={today(timezone)} />;
}
