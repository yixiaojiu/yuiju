import { getEnvironment } from "../env/environment";

export function mongoCollectionName(name: string): string {
  return getEnvironment() === "production" ? name : `${name}_dev`;
}

export function redisKeyPrefix(): string {
  return getEnvironment() === "production" ? "yuiju:prod:" : "yuiju:dev:";
}
