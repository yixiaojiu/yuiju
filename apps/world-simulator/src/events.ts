import { randomUUID } from "node:crypto";
import type { ActivityView, WorldEvent } from "@yuiju/shared/world/protocol";
import { observePlace, positionView } from "./inspect";
import type { WorldMap } from "./map";
import type { WorldState } from "./state";

/** 世界事实与按接收者过滤后的通知一起保存，重连不按新的位置重算接收范围。 */
export type WorldFact = {
  eventId: string;
  occurredAt: number;
  type: Exclude<WorldEvent["type"], "idle_reminder">;
  characterId: string | null;
  placeId: string | null;
  activity: ActivityView | null;
  description: string;
  notifications: WorldEvent[];
};

export function createWorldFact(
  input: Omit<WorldFact, "eventId" | "notifications">,
  state: WorldState,
  map: WorldMap,
  names: ReadonlyMap<string, string>,
  timezone: string,
): WorldFact {
  const eventId = randomUUID();
  const receivers = Object.values(state.characters).filter(
    (character) =>
      input.type === "weather_changed" ||
      character.characterId === input.characterId ||
      (input.placeId !== null && character.placeId === input.placeId),
  );
  const notifications = receivers.map((character): WorldEvent => {
    const notification: WorldEvent = {
      eventId,
      occurredAt: input.occurredAt,
      characterId: character.characterId,
      type: input.type,
      description:
        input.characterId !== null && character.characterId !== input.characterId
          ? `${names.get(input.characterId)}：${input.description}`
          : input.description,
      activity: input.activity,
      position: positionView(character, map),
    };
    if (
      input.type === "activity_completed" &&
      input.activity?.actionId === "移动" &&
      character.characterId === input.characterId
    ) {
      notification.observation = observePlace(
        character.placeId,
        { state, character, now: input.occurredAt, timezone },
        names,
      );
    }
    return notification;
  });
  return { ...input, eventId, notifications };
}
