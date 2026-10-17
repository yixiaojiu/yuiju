import { notFound } from "next/navigation";
import { ConversationsPage } from "@/features/settings/conversations-page";
import { getDeployment } from "@/lib/deployment";

export default async function Page() {
  if ((await getDeployment()).publicDeployment) {
    notFound();
  }
  return <ConversationsPage />;
}
