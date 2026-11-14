import { notFound } from "next/navigation";
import { CalendarPage } from "@/features/calendar/calendar-page";
import { getDeployment } from "@/lib/deployment";

export default async function Page() {
  const deployment = await getDeployment();
  if (deployment.publicDeployment) {
    notFound();
  }
  return <CalendarPage characters={deployment.characters} timezone={deployment.timezone} />;
}
