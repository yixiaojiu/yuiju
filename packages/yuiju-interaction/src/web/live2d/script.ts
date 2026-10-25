import { builtInActions } from "../../protocol.ts";

export type PerformanceBeat =
  | { type: "action"; tags: string[] }
  | { type: "speech"; text: string; cues: { offset: number; tags: string[] }[] };

/** 流式解析台本。未闭合标记跨 chunk 保留，标记永远不进入 TTS 文本。 */
export class ScriptParser {
  private text = "";
  private cues: Extract<PerformanceBeat, { type: "speech" }>["cues"] = [];
  private tag: string | null = null;
  private closing = "";
  private readonly tags: Set<string>;

  constructor(expressions: string[]) {
    this.tags = new Set([...expressions, ...builtInActions]);
  }

  push(chunk: string): PerformanceBeat[] {
    const beats: PerformanceBeat[] = [];
    for (const character of chunk) {
      if (this.tag !== null) {
        if (character !== this.closing) {
          this.tag += character;
          continue;
        }
        const tags = this.tag.split(/[,，]/).map((tag) => tag.trim());
        if (tags.some((tag) => !this.tags.has(tag))) {
          throw new Error(`无法执行表演标记：${this.tag}`);
        }
        if (this.closing === "】") {
          beats.push({ type: "action", tags });
        } else {
          this.cues.push({ offset: this.text.length, tags });
        }
        this.tag = null;
      } else if (character === "【" || character === "<") {
        if (character === "【") {
          beats.push(...this.flush());
        }
        this.tag = "";
        this.closing = character === "【" ? "】" : ">";
      } else {
        this.text += character;
        if (/[。！？!?；;\n]/.test(character)) {
          beats.push(...this.flush());
        }
      }
    }
    return beats;
  }

  finish(): PerformanceBeat[] {
    if (this.tag !== null) {
      throw new Error("模型输出了未闭合的表演标记");
    }
    return this.flush();
  }

  private flush(): PerformanceBeat[] {
    const { text, cues } = this;
    this.text = "";
    this.cues = [];
    if (text.trim()) {
      return [{ type: "speech", text, cues }];
    }
    if (cues.length) {
      return [{ type: "action", tags: cues.flatMap((cue) => cue.tags) }];
    }
    return [];
  }
}
