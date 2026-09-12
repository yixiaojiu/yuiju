import { notFound } from "next/navigation";
import { isPublicDeployment } from "@/lib/public-deployment";
import { SettingsClient } from "./settings-client";

export default function SettingsPage() {
  if (isPublicDeployment()) {
    notFound();
  }

  return <SettingsClient />;
}
