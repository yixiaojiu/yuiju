import { notFound } from "next/navigation";
import { getExtensionPages } from "@/extensions/server";

export default async function ExtensionPage({
  params,
}: {
  params: Promise<{ extension: string; characterId: string; pageId: string }>;
}) {
  const { extension, characterId, pageId } = await params;
  const page = (await getExtensionPages()).find(
    (page) =>
      page.extension === extension && page.character.id === characterId && page.pageId === pageId,
  );
  if (!page) {
    notFound();
  }
  const Component = page.component;
  return <Component character={page.character} apiBasePath={page.apiBasePath} />;
}
