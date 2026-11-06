import { notFound } from "next/navigation";
import { AlertsPage } from "@/features/alerts/alerts-page";
import { today } from "@/lib/date";
import { getDeployment } from "@/lib/deployment";

export default async function Page() {
  const { publicDeployment, timezone, characters } = await getDeployment();
  if (publicDeployment) {
    notFound();
  }
  return <AlertsPage characters={characters} initialDate={today(timezone)} />;
}
