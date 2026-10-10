import { MemoriesPage } from "@/features/memories/memories-page";
import { getDeployment } from "@/lib/deployment";

export default async function Page() {
  const { publicDeployment } = await getDeployment();
  return <MemoriesPage publicDeployment={publicDeployment} />;
}
