import { notFound } from "next/navigation";
import { StickersPage } from "@/features/stickers/stickers-page";
import { getDeployment } from "@/lib/deployment";

export default async function Page() {
  const { publicDeployment, characters } = await getDeployment();
  if (publicDeployment) {
    notFound();
  }
  return <StickersPage characters={characters} />;
}
