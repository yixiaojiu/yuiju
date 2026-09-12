import { notFound } from "next/navigation";
import { isPublicDeployment } from "@/lib/public-deployment";
import { ChatClient } from "./chat-client";

export default function ChatPage() {
  if (isPublicDeployment()) {
    notFound();
  }

  return <ChatClient />;
}
