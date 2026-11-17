import { studyActionId } from "../content/school-attendance";
import { currentSchoolPeriod } from "../content/school-calendar";
import { changeBody } from "../state";
import { emptyPayloadSchema } from "./anywhere";
import { minimumStamina } from "./conditions";
import { defineAction } from "./definition";

export const study = defineAction({
  id: studyActionId,
  description: "按课表上当前这节课，下课时结束，每节消耗 3 点体力和 1 点饱腹。",
  placeIds: ["campus"],
  identities: ["student"],
  schema: emptyPayloadSchema,
  durationDescription: "到这节课下课",
  randomEvent: { probability: 0.1, positiveProbability: 0.4 },
  conditions: [
    minimumStamina(10),
    {
      description: "处于课表中的上课时间",
      check: ({ now, timezone }) => (currentSchoolPeriod(now, timezone) ? "met" : "unmet"),
    },
  ],
  start({ now, timezone }) {
    const period = currentSchoolPeriod(now, timezone)!;
    return {
      durationMinutes: (period.endAt - now) / 60_000,
      settlement: { subject: period.subject },
      description: `开始上${period.subject}课`,
    };
  },
  complete({ character }, { subject }) {
    changeBody(character, -3, -1);
    return { description: `上完了${subject}课` };
  },
});
