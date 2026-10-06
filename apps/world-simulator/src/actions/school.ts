import { localTimestamp, worldTime } from "../environment/time";
import { changeBody } from "../state";
import { emptyPayloadSchema } from "./anywhere";
import { minimumStamina } from "./conditions";
import { defineAction } from "./definition";

export const study = defineAction({
  id: "在学校学习",
  description: "在学校上课，到午休或放学时结束，消耗 12 点体力和饱腹。",
  placeIds: ["campus"],
  identities: ["student"],
  schema: emptyPayloadSchema,
  durationDescription: "上午到 12:00，下午到 16:00",
  randomEvent: { probability: 0.2, positiveProbability: 0.4 },
  conditions: [
    minimumStamina(22),
    {
      description: "工作日 09:00–12:00 或 14:00–16:00",
      check: ({ now, timezone }) => {
        const time = worldTime(now, timezone);
        return time.day() >= 1 &&
          time.day() <= 5 &&
          ((time.hour() >= 9 && time.hour() < 12) || (time.hour() >= 14 && time.hour() < 16))
          ? "met"
          : "unmet";
      },
    },
  ],
  start({ now, timezone }) {
    const time = worldTime(now, timezone);
    const end = localTimestamp(time.format("YYYY-MM-DD"), time.hour() < 12 ? 12 : 16, 0, timezone);
    return { durationMinutes: (end - now) / 60_000, settlement: {}, description: "开始上课" };
  },
  complete({ character }) {
    changeBody(character, -12, -12);
    return { description: "上完了课" };
  },
});
