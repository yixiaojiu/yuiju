import { notFound } from "next/navigation";
import { LogsPage } from "@/features/logs/logs-page";
import { getDeployment } from "@/lib/deployment";

export default async function Page() {
  const { publicDeployment, timezone } = await getDeployment();
  if (publicDeployment) {
    notFound();
  }
  return <LogsPage timezone={timezone} />;
}
