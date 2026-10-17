import { MemoriesPage } from "@/features/memories/memories-page";
import { getDeployment } from "@/lib/deployment";

export default async function Page() {
  const { publicDeployment, characters } = await getDeployment();
  return <MemoriesPage characters={characters} publicDeployment={publicDeployment} />;
}
