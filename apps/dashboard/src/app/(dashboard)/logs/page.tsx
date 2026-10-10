import { notFound } from "next/navigation";
import { LogsPage } from "@/features/logs/logs-page";
import { getDeployment } from "@/lib/deployment";

export default async function Page() {
  const { publicDeployment } = await getDeployment();
  if (publicDeployment) {
    notFound();
  }
  return <LogsPage />;
}
