import type { ExtensionApiDefinition } from "@yuiju/shared/extension/api";
import { createRoutes } from "./src/api/routes.ts";
export default {
  access: "private",
  create: createRoutes,
} satisfies ExtensionApiDefinition;
