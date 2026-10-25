import { expect, it } from "vitest";
import { streetViewSchema, streetViewScreenSchema } from "./protocol.ts";

it("旋转四方向均要求角度，缩放只支持地图且拒绝旧参数", () => {
  for (const direction of ["up", "down", "left", "right"]) {
    expect(streetViewSchema.parse({ type: "look", direction, angle: 15 })).toEqual({
      type: "look",
      direction,
      angle: 15,
    });
  }
  expect(streetViewSchema.parse({ type: "zoom", direction: "in" })).toEqual({
    type: "zoom",
    direction: "in",
  });
  for (const input of [
    { type: "look", direction: "left", amount: "small" },
    { type: "look", direction: "left", angle: 0 },
    { type: "look", direction: "left", angle: 181 },
    { type: "zoom", direction: "in", target: "panorama" },
  ]) {
    expect(streetViewSchema.safeParse(input).success).toBe(false);
  }
});

it("街景回执必须包含实际朝向，不能丢失视角或用默认方向填补", () => {
  const screen = {
    image: "AA==",
    width: 100,
    height: 100,
    title: "Maps",
    url: "https://google.com/maps",
  };
  expect(streetViewScreenSchema.safeParse(screen).success).toBe(false);
  const orientation = { heading: 135, direction: "东南", pitch: 15 };
  expect(streetViewScreenSchema.parse({ ...screen, orientation }).orientation).toEqual(orientation);
});
