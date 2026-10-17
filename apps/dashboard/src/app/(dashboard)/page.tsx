import { HomePage } from "@/features/home/home-page";
import { getDeployment } from "@/lib/deployment";

export default async function Page() {
  const { characters } = await getDeployment();
  return <HomePage characters={characters} />;
}
