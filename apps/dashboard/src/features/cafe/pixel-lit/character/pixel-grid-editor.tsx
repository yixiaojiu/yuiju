import { Minus, Plus } from "lucide-react";
import { useRef } from "react";

export type GridEdge = "top" | "bottom" | "left" | "right";
/** 画布扩展：can 判断在某一边加（1）或减（-1）一行（列）能不能做，apply 执行。 */
export type GridResize = {
  can: (edge: GridEdge, delta: 1 | -1) => boolean;
  apply: (edge: GridEdge, delta: 1 | -1) => void;
};

const edgeLabels: Record<GridEdge, string> = {
  top: "上边",
  bottom: "下边",
  left: "左边",
  right: "右边",
};

/** 一条边上的「+ / −」：在这一边加一行（列）或删一行（列）。 */
function EdgeButtons({
  edge,
  resize,
  vertical,
}: {
  edge: GridEdge;
  resize: GridResize;
  vertical: boolean;
}) {
  return (
    <div className={`flex items-center justify-center gap-0.5 ${vertical ? "flex-col" : ""}`}>
      {([1, -1] as const).map((delta) => (
        <button
          key={delta}
          type="button"
          title={`${edgeLabels[edge]}${delta > 0 ? "加" : "删"}一${edge === "top" || edge === "bottom" ? "行" : "列"}`}
          disabled={!resize.can(edge, delta)}
          className="rounded p-0.5 text-[#786c60] hover:bg-[#efe8dc] disabled:opacity-25 disabled:hover:bg-transparent"
          onClick={() => resize.apply(edge, delta)}
        >
          {delta > 0 ? <Plus size={12} /> : <Minus size={12} />}
        </button>
      ))}
    </div>
  );
}

/**
 * 像素网格画板：按下后拖动，经过的格子都交给 onPaint 改成当前笔刷。
 * 按下时把指针锁在画板上，之后按指针位置换算是哪一格，触控板、手写笔拖动也能连续上色；
 * 拖得快跳过了中间的格子时，按直线把两次之间的格子补上。
 * transparent 为 true 时 . 是透明格（眼睛、嘴、手、胸前图案），画成棋盘格；否则 . 按 colorOf 显示成皮肤。
 * resize 不为 null 时四周有「+ / −」，可以在任意一边加减行列。
 */
export function PixelGridEditor({
  rows,
  colorOf,
  transparent,
  onPaint,
  resize,
}: {
  rows: readonly string[];
  colorOf: (letter: string) => string;
  transparent: boolean;
  onPaint: (row: number, column: number) => void;
  resize: GridResize | null;
}) {
  const grid = useRef<HTMLDivElement>(null);
  /** 拖动中上一次上色的格子，没在拖动时为 null。 */
  const last = useRef<[number, number] | null>(null);
  const columns = rows[0].length;
  // 18 格的脸约 16px 一格，手这类小图案放大到最多 28px 一格，都在右栏宽度内。
  const cell = Math.min(28, Math.floor(250 / Math.max(columns, rows.length * 0.8)));

  /** 指针下面是哪一格，在画板外时为 null。 */
  function cellAt(event: React.PointerEvent): [number, number] | null {
    const rect = grid.current!.getBoundingClientRect();
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * rows.length);
    const column = Math.floor(((event.clientX - rect.left) / rect.width) * columns);
    if (row < 0 || row >= rows.length || column < 0 || column >= columns) {
      return null;
    }
    return [row, column];
  }

  const canvas = (
    <div
      ref={grid}
      className="grid w-fit touch-none select-none gap-px border border-[#cfc6b8] bg-[#cfc6b8]"
      style={{ gridTemplateColumns: `repeat(${columns}, ${cell}px)` }}
      onPointerDown={(event) => {
        const target = cellAt(event);
        if (!target) {
          return;
        }
        grid.current!.setPointerCapture(event.pointerId);
        onPaint(...target);
        last.current = target;
      }}
      onPointerMove={(event) => {
        const target = cellAt(event);
        if (!last.current || !target) {
          return;
        }
        const [fromRow, fromColumn] = last.current;
        const steps = Math.max(Math.abs(target[0] - fromRow), Math.abs(target[1] - fromColumn));
        for (let step = 1; step <= steps; step++) {
          onPaint(
            Math.round(fromRow + ((target[0] - fromRow) * step) / steps),
            Math.round(fromColumn + ((target[1] - fromColumn) * step) / steps),
          );
        }
        last.current = target;
      }}
      onPointerUp={() => {
        last.current = null;
      }}
      onPointerCancel={() => {
        last.current = null;
      }}
    >
      {rows.map((line, row) =>
        [...line].map((letter, column) => (
          <div
            key={`${row}-${column}`}
            style={{
              height: cell,
              background:
                transparent && letter === "."
                  ? "repeating-conic-gradient(#eee6da 0% 25%, #fdfaf4 0% 50%) 50% / 8px 8px"
                  : colorOf(letter),
            }}
          />
        )),
      )}
    </div>
  );

  if (!resize) {
    return canvas;
  }
  return (
    <div className="grid w-fit grid-cols-[auto_auto_auto] items-center gap-1">
      <span />
      <EdgeButtons edge="top" resize={resize} vertical={false} />
      <span />
      <EdgeButtons edge="left" resize={resize} vertical />
      {canvas}
      <EdgeButtons edge="right" resize={resize} vertical />
      <span />
      <EdgeButtons edge="bottom" resize={resize} vertical={false} />
      <span />
      <span className="col-span-3 text-center font-mono text-xs text-[#94877a]">
        {columns} × {rows.length}
      </span>
    </div>
  );
}
