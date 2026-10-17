import { ActivitiesPage } from "@/features/activities/activities-page";
import { getDeployment } from "@/lib/deployment";

export default async function Page() {
  const { characters } = await getDeployment();
  return <ActivitiesPage characters={characters} />;
}
