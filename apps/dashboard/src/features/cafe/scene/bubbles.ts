import type { Object3D } from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { BUBBLE_LIFETIME_MS, type Bubble } from "../session/state";

/** 一个角色头顶最多同时显示的气泡条数，旧的在上、新的在下。 */
const MAX_VISIBLE_BUBBLES = 3;

/**
 * 头顶的对话气泡和名字。气泡是普通的网页元素，由 CSS2DRenderer 每帧跟随角色头顶的位置。
 * 每个角色一个锚点，用 id 区分。
 */
export class BubbleLayer {
  readonly renderer = new CSS2DRenderer();
  private readonly anchors = new Map<string, { object: CSS2DObject; key: string }>();

  constructor(container: HTMLElement) {
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.domElement.className = "pointer-events-none absolute inset-0";
    container.appendChild(this.renderer.domElement);
  }

  /** 给角色挂一个锚点，height 是锚点在角色局部坐标里的高度（头顶上方一点）。 */
  attach(id: string, parent: Object3D, height: number) {
    const element = document.createElement("div");
    element.className = "flex flex-col items-center gap-1";
    const object = new CSS2DObject(element);
    object.position.set(0, height, 0);
    object.center.set(0.5, 1);
    parent.add(object);
    this.anchors.set(id, { object, key: "" });
  }

  detach(id: string) {
    const anchor = this.anchors.get(id)!;
    anchor.object.removeFromParent();
    anchor.object.element.remove();
    this.anchors.delete(id);
  }

  has(id: string) {
    return this.anchors.has(id);
  }

  /** 更新一个角色头顶的内容：未过期的最近几条气泡，以及名字（name 为 null 时不显示名字）。 */
  show(id: string, bubbles: Bubble[], name: string | null, now: number) {
    const anchor = this.anchors.get(id)!;
    const visible = bubbles
      .filter((bubble) => now - bubble.createdAt < BUBBLE_LIFETIME_MS)
      .slice(-MAX_VISIBLE_BUBBLES);
    // 内容没变就不重建元素，避免每帧都改网页。
    const key = `${name}|${visible.map((bubble) => bubble.id).join(",")}`;
    if (key === anchor.key) {
      return;
    }
    anchor.key = key;
    const element = anchor.object.element;
    element.replaceChildren();
    for (const bubble of visible) {
      const item = document.createElement("div");
      item.className = bubble.thinking
        ? "rounded-2xl bg-white/85 px-4 py-1 text-lg font-bold tracking-widest text-stone-500 shadow-md"
        : "max-w-64 rounded-2xl bg-[#fbf6ec]/95 px-4 py-2 text-center text-sm leading-relaxed text-stone-800 shadow-md";
      item.textContent = bubble.text;
      element.appendChild(item);
    }
    if (name) {
      const tag = document.createElement("div");
      tag.className = "rounded-full bg-black/45 px-2 py-0.5 text-xs text-white";
      tag.textContent = name;
      element.appendChild(tag);
    }
  }

  setSize(width: number, height: number) {
    this.renderer.setSize(width, height);
  }

  dispose() {
    for (const id of [...this.anchors.keys()]) {
      this.detach(id);
    }
    this.renderer.domElement.remove();
  }
}
