import { ActivitiesPage } from "@/features/activities/activities-page";
import { today } from "@/lib/date";
import { getDeployment } from "@/lib/deployment";

export default async function Page() {
  const { timezone } = await getDeployment();
  return <ActivitiesPage timezone={timezone} initialDate={today(timezone)} />;
}
