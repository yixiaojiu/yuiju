import { MajorScene } from "../types/state";

export const worldGuideTopics = [
  "worldMap",
  "shopProducts",
  "cafeMenu",
  "shrineIntroduction",
  "placeIntroductions",
] as const;

export type WorldGuideTopic = (typeof worldGuideTopics)[number];

export const worldGuidePlaceIntroductions = [
  {
    name: MajorScene.Home,
    introduction: "独自生活的地方，有带书桌的卧室和挂着两个风铃的小阳台。",
    availableActivities: ["吃早餐", "吃晚餐", "休息", "整理自己的状态"],
  },
  {
    name: MajorScene.School,
    introduction: "日式高中学校，上课时间为9点-12点、14点-16点。",
    availableActivities: ["上课", "学习", "度过校园时间"],
  },
  {
    name: MajorScene.Shop,
    introduction: "星见町的便利商店/零食铺，可以花金币购买零食。",
    availableActivities: ["购买零食"],
  },
  {
    name: MajorScene.Cafe,
    introduction: "气氛安静的小咖啡馆，可以兼职打工，也可以在这里购买各种咖啡。",
    availableActivities: ["点咖啡", "兼职打工"],
  },
  {
    name: MajorScene.Park,
    introduction: "适合散步放松的公园，可以让心情慢慢恢复。",
    availableActivities: ["散步", "放松", "恢复心情"],
  },
  {
    name: MajorScene.Shrine,
    introduction: "供奉神明的地方，可以参拜，适合在安静的氛围里整理心绪。",
    availableActivities: ["参拜", "投币祈愿", "恢复心情"],
  },
  {
    name: MajorScene.Coast,
    introduction: "位于小町商店东边的海岸步道，路程较远，适合散步放松。",
    availableActivities: ["散步", "看海", "恢复心情"],
  },
];

export const shrineIntroduction = {
  name: MajorScene.Shrine,
  introduction: "结灯神社是星见町里供奉神明的地方，位置在南风公园南侧。",
  atmosphere: "安静、清透，适合让心情沉下来。",
  availableActivities: ["参拜", "投币祈愿", "恢复心情"],
  note: "参拜时可以认真祈愿；是否投币、祈愿内容应结合当时心情、金币和计划决定。",
};
