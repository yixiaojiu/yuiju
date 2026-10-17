import { load_config } from "@yuiju/shared/config/load";

export async function getDeployment() {
  const config = await load_config();
  return {
    publicDeployment: config.app!.public_deployment!,
    source: config.app!.public_deployment ? ("sync" as const) : ("primary" as const),
    timezone: config.app!.timezone!,
    characters: Object.entries(config.characters!).map(([id, character]) => ({
      id,
      name: character.name,
    })),
  };
}
