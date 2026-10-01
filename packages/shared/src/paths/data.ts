import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function get_data_dir() {
  const data_dir = fileURLToPath(new URL("../../../../data/", import.meta.url));
  await mkdir(data_dir, { recursive: true });
  return data_dir;
}
