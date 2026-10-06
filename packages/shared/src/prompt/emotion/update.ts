import type { PromptTemplate } from "../template";

export const emotionUpdatePrompt: PromptTemplate = {
  key: "emotion.update",
  description: "把角色对事情的感受转为三个情绪维度的变化建议。",
  template: `你需要结合已有情绪、仍在影响你的感受与本批新感受，判断情绪是否发生了实质变化。
重复表达、同一事实的改写不能反复叠加影响。没有新的实质变化时，各维度返回 0。不同事件可以同时影响你，不必把旧感受全部替换。
愉悦度表示愉快与不愉快；激活度表示平静与激动，不是正负情绪；掌控感表示自主与受制，不是能力或成功率。
只给出变化方向和轻微、明显、强烈程度，程序负责实际数值。允许重要事件立即引起强烈变化。最多保留 12 条仍有影响的感受，合并重复表达、移除已释怀的事情，引用真实 sourceId，不编造来源。`,
};
