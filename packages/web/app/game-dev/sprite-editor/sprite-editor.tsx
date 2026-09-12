"use client";

import { useEffect, useRef, useState } from "react";

const FRAME_PREVIEW_SIZE = 128;

type SourceSheet = {
  name: string;
  url: string;
  width: number;
  height: number;
  frameSize: number;
  frameCount: number;
};

type AnimationFrame = {
  key: string;
  sourceName: string;
  sourceUrl: string;
  sheetWidth: number;
  sheetHeight: number;
  frameSize: number;
  offsetX: number;
  offsetY: number;
};

type SpriteEditorProps = {
  sourceSheets: SourceSheet[];
};

function SpriteFrame({ frame, alt }: { frame: AnimationFrame; alt: string }) {
  const previewScale = FRAME_PREVIEW_SIZE / frame.frameSize;

  return (
    <div className="h-[128px] w-[128px] overflow-hidden">
      <img
        src={frame.sourceUrl}
        width={frame.sheetWidth}
        height={frame.sheetHeight}
        alt={alt}
        draggable={false}
        className="block max-w-none select-none [image-rendering:pixelated]"
        style={{
          width: frame.sheetWidth * previewScale,
          height: frame.sheetHeight * previewScale,
          transform: `translate(-${frame.offsetX * previewScale}px, -${frame.offsetY * previewScale}px)`,
        }}
      />
    </div>
  );
}

export function SpriteEditor({ sourceSheets }: SpriteEditorProps) {
  const hoverPreviewTimer = useRef<number | undefined>(undefined);
  const hoveredFrameKey = useRef<string | undefined>(undefined);
  const logicalPixelHeightByFrameKey = useRef(new Map<string, number>());
  const [animationFrames, setAnimationFrames] = useState<AnimationFrame[]>([]);
  const [frameDuration, setFrameDuration] = useState(150);
  const [animationTick, setAnimationTick] = useState(0);
  const [hoverPreview, setHoverPreview] = useState<{
    frame: AnimationFrame;
    logicalPixelHeight: number;
  }>();

  useEffect(() => {
    if (animationFrames.length === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setAnimationTick((currentAnimationTick) => currentAnimationTick + 1);
    }, frameDuration);

    return () => window.clearInterval(intervalId);
  }, [animationFrames.length, frameDuration]);

  useEffect(
    () => () => {
      window.clearTimeout(hoverPreviewTimer.current);
    },
    [],
  );

  const toggleFrame = (sourceSheet: SourceSheet, offsetX: number, offsetY: number) => {
    const frameKey = `${sourceSheet.url}:${offsetX}:${offsetY}`;
    setAnimationFrames((currentFrames) => {
      if (currentFrames.some((frame) => frame.key === frameKey)) {
        return currentFrames.filter((frame) => frame.key !== frameKey);
      }

      return [
        ...currentFrames,
        {
          key: frameKey,
          sourceName: sourceSheet.name,
          sourceUrl: sourceSheet.url,
          sheetWidth: sourceSheet.width,
          sheetHeight: sourceSheet.height,
          frameSize: sourceSheet.frameSize,
          offsetX,
          offsetY,
        },
      ];
    });
  };

  const startHoverPreview = (frame: AnimationFrame) => {
    hoveredFrameKey.current = frame.key;
    hoverPreviewTimer.current = window.setTimeout(async () => {
      let logicalPixelHeight = logicalPixelHeightByFrameKey.current.get(frame.key);

      if (logicalPixelHeight === undefined) {
        const image = new Image();
        image.src = frame.sourceUrl;
        await image.decode();

        const canvas = document.createElement("canvas");
        canvas.width = frame.frameSize;
        canvas.height = frame.frameSize;
        const context = canvas.getContext("2d")!;
        context.drawImage(
          image,
          frame.offsetX,
          frame.offsetY,
          frame.frameSize,
          frame.frameSize,
          0,
          0,
          frame.frameSize,
          frame.frameSize,
        );

        const framePixels = context.getImageData(0, 0, frame.frameSize, frame.frameSize).data;
        let top = frame.frameSize;
        let bottom = -1;
        for (let y = 0; y < frame.frameSize; y += 1) {
          for (let x = 0; x < frame.frameSize; x += 1) {
            if (framePixels[(y * frame.frameSize + x) * 4 + 3] === 0) {
              continue;
            }

            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }

        if (bottom === -1) {
          throw new Error(`${frame.sourceName} 的帧 ${frame.offsetX}, ${frame.offsetY} 为空。`);
        }

        logicalPixelHeight = bottom - top + 1;
        logicalPixelHeightByFrameKey.current.set(frame.key, logicalPixelHeight);
      }

      if (hoveredFrameKey.current === frame.key) {
        setHoverPreview({ frame, logicalPixelHeight });
      }
    }, 1000);
  };

  const previewSourceSheet = (sourceSheet: SourceSheet) => {
    setAnimationFrames(
      Array.from({ length: sourceSheet.frameCount }, (_, frameIndex) => ({
        key: `${sourceSheet.url}:${frameIndex * sourceSheet.frameSize}:0`,
        sourceName: sourceSheet.name,
        sourceUrl: sourceSheet.url,
        sheetWidth: sourceSheet.width,
        sheetHeight: sourceSheet.height,
        frameSize: sourceSheet.frameSize,
        offsetX: frameIndex * sourceSheet.frameSize,
        offsetY: 0,
      })),
    );
    setAnimationTick(0);
  };

  const stopHoverPreview = () => {
    hoveredFrameKey.current = undefined;
    window.clearTimeout(hoverPreviewTimer.current);
    hoverPreviewTimer.current = undefined;
    setHoverPreview(undefined);
  };

  const moveFrame = (frameIndex: number, nextFrameIndex: number) => {
    setAnimationFrames((currentFrames) => {
      const nextFrames = [...currentFrames];
      const [frame] = nextFrames.splice(frameIndex, 1);
      nextFrames.splice(nextFrameIndex, 0, frame);
      return nextFrames;
    });
  };

  const exportSpriteSheet = async () => {
    const frameSize = animationFrames[0].frameSize;
    const canvas = document.createElement("canvas");
    canvas.width = animationFrames.length * frameSize;
    canvas.height = frameSize;
    const context = canvas.getContext("2d")!;
    context.imageSmoothingEnabled = false;

    const sourceImages = new Map<string, HTMLImageElement>();
    for (const frame of animationFrames) {
      if (!sourceImages.has(frame.sourceUrl)) {
        const image = new Image();
        image.src = frame.sourceUrl;
        await image.decode();
        sourceImages.set(frame.sourceUrl, image);
      }
    }

    animationFrames.forEach((frame, frameIndex) => {
      context.drawImage(
        sourceImages.get(frame.sourceUrl)!,
        frame.offsetX,
        frame.offsetY,
        frame.frameSize,
        frame.frameSize,
        frameIndex * frameSize,
        0,
        frameSize,
        frameSize,
      );
    });

    const spriteSheetBlob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => resolve(blob!), "image/png");
    });
    const downloadUrl = URL.createObjectURL(spriteSheetBlob);
    const downloadLink = document.createElement("a");
    downloadLink.href = downloadUrl;
    downloadLink.download = "animation.png";
    downloadLink.click();
    URL.revokeObjectURL(downloadUrl);
  };

  const currentPreviewFrame =
    animationFrames.length > 0
      ? animationFrames[animationTick % animationFrames.length]
      : undefined;

  return (
    <div className="grid gap-[20px] lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="grid content-start gap-[16px] rounded-[12px] border-2 border-[#493247] bg-[#fff9ea] p-[16px] shadow-[0_18px_50px_rgb(72_48_59_/_12%)]">
        <div>
          <h2 className="font-fusion-pixel text-[20px]">素材帧</h2>
          <p className="mt-[4px] text-[14px] text-[#7b665d]">
            勾选需要的帧；连续悬停 1 秒可以查看放大预览。
          </p>
        </div>

        {sourceSheets.length === 0 ? (
          <p className="rounded-[8px] bg-[#efe2c8] p-[16px] text-[14px]">
            source-sheets 文件夹中还没有 PNG 图片。
          </p>
        ) : null}

        {sourceSheets.map((sourceSheet) => {
          const isCompatibleWithSelection =
            animationFrames.length === 0 || animationFrames[0].frameSize === sourceSheet.frameSize;

          return (
            <article
              key={sourceSheet.url}
              className="grid gap-[12px] border-t border-[#cbb99b] pt-[16px]"
            >
              <div className="flex items-center justify-between gap-[12px]">
                <h3 className="font-fusion-pixel text-[16px]">{sourceSheet.name}</h3>
                <button
                  type="button"
                  className="rounded border border-[#806458] px-[8px] py-[4px] text-[13px]"
                  onClick={() => previewSourceSheet(sourceSheet)}
                >
                  预览整张
                </button>
              </div>
              <div className="flex flex-wrap gap-[8px]">
                {Array.from({ length: sourceSheet.frameCount }, (_, frameIndex) => {
                  const offsetX = frameIndex * sourceSheet.frameSize;
                  const offsetY = 0;
                  const frame: AnimationFrame = {
                    key: `${sourceSheet.url}:${offsetX}:${offsetY}`,
                    sourceName: sourceSheet.name,
                    sourceUrl: sourceSheet.url,
                    sheetWidth: sourceSheet.width,
                    sheetHeight: sourceSheet.height,
                    frameSize: sourceSheet.frameSize,
                    offsetX,
                    offsetY,
                  };
                  const isSelected = animationFrames.some(
                    (animationFrame) => animationFrame.key === frame.key,
                  );
                  const selectedIndex = animationFrames.findIndex(
                    (animationFrame) => animationFrame.key === frame.key,
                  );

                  return (
                    <div key={`${offsetX}-${offsetY}`} className="relative">
                      <button
                        type="button"
                        disabled={!isCompatibleWithSelection}
                        title={`选择偏移 ${offsetX}, ${offsetY}`}
                        aria-pressed={isSelected}
                        className={`relative block cursor-pointer overflow-hidden rounded-[6px] border-2 bg-[#e7d9bd] p-0 transition-transform hover:-translate-y-[2px] ${
                          isSelected
                            ? "border-[#493247] shadow-[0_0_0_3px_rgb(73_50_71_/_20%)]"
                            : "border-[#806458] hover:border-[#493247]"
                        }`}
                        onMouseEnter={() => startHoverPreview(frame)}
                        onMouseLeave={stopHoverPreview}
                        onClick={() => toggleFrame(sourceSheet, offsetX, offsetY)}
                      >
                        <SpriteFrame frame={frame} alt="" />
                      </button>
                      <input
                        type="checkbox"
                        disabled={!isCompatibleWithSelection}
                        checked={isSelected}
                        aria-label={`选择 ${sourceSheet.name} 偏移 ${offsetX}, ${offsetY}`}
                        className="absolute top-[7px] right-[7px] z-20 h-[20px] w-[20px] cursor-pointer accent-[#493247]"
                        onChange={() => toggleFrame(sourceSheet, offsetX, offsetY)}
                      />
                      {isSelected ? (
                        <span className="pointer-events-none absolute top-[7px] left-[7px] z-20 grid h-[22px] min-w-[22px] place-items-center rounded-full bg-[#493247] px-[5px] font-fusion-pixel text-[12px] text-[#fff9ea]">
                          {selectedIndex + 1}
                        </span>
                      ) : null}

                      {hoverPreview?.frame.key === frame.key ? (
                        <div className="pointer-events-none absolute top-0 left-full z-50 ml-[10px] h-[256px] w-[256px] overflow-hidden rounded-[8px] border-4 border-[#493247] bg-[#d9b879] shadow-[0_18px_45px_rgb(72_48_59_/_30%)]">
                          <div className="origin-top-left scale-[2]">
                            <SpriteFrame frame={frame} alt="放大的素材帧" />
                          </div>
                          <p className="absolute right-[8px] bottom-[8px] left-[8px] rounded-[4px] bg-[#493247]/90 px-[8px] py-[5px] text-center font-fusion-pixel text-[12px] text-[#fff9ea]">
                            逻辑像素高：{hoverPreview.logicalPixelHeight} px
                          </p>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </section>

      <aside className="grid content-start gap-[16px] lg:sticky lg:top-[20px] lg:self-start">
        <section className="grid justify-items-center gap-[12px] rounded-[12px] border-2 border-[#493247] bg-[#d9b879] p-[16px]">
          <h2 className="font-fusion-pixel text-[20px]">动画预览</h2>
          <div className="grid h-[160px] w-[160px] place-items-center overflow-hidden rounded-[8px] bg-[#b9a37b]">
            {currentPreviewFrame ? (
              <SpriteFrame frame={currentPreviewFrame} alt="当前动画帧" />
            ) : (
              <span className="text-[14px] text-[#725e54]">请选择动画帧</span>
            )}
          </div>
          <label className="flex items-center gap-[8px] text-[14px]">
            每帧
            <input
              type="number"
              min={50}
              step={50}
              value={frameDuration}
              className="w-[88px] rounded-[4px] border border-[#806458] bg-[#fff9ea] px-[8px] py-[5px] text-right"
              onChange={(event) => setFrameDuration(Number(event.target.value))}
            />
            ms
          </label>
        </section>

        <section className="grid gap-[12px] rounded-[12px] border-2 border-[#493247] bg-[#fff9ea] p-[16px]">
          <div className="flex items-center justify-between gap-[12px]">
            <h2 className="font-fusion-pixel text-[20px]">动画帧序列</h2>
            <button
              type="button"
              disabled={animationFrames.length === 0}
              className="rounded-[4px] border border-[#806458] px-[8px] py-[4px] text-[13px] disabled:opacity-40"
              onClick={() => {
                setAnimationFrames([]);
                setAnimationTick(0);
              }}
            >
              清空
            </button>
          </div>

          <div className="grid max-h-[420px] gap-[10px] overflow-y-auto">
            {animationFrames.map((frame, frameIndex) => (
              <article
                key={frame.key}
                className="grid grid-cols-[64px_minmax(0,1fr)] gap-[10px] rounded-[6px] bg-[#efe2c8] p-[8px]"
              >
                <div className="h-[64px] w-[64px] overflow-hidden">
                  <div className="origin-top-left scale-50">
                    <SpriteFrame frame={frame} alt="" />
                  </div>
                </div>
                <div className="grid content-center gap-[5px] text-[12px]">
                  <p className="truncate" title={frame.sourceName}>
                    {frameIndex + 1}. {frame.sourceName}
                  </p>
                  <p className="text-[#7b665d]">
                    偏移 x={frame.offsetX}，y={frame.offsetY}
                  </p>
                  <div className="flex flex-wrap gap-[4px]">
                    <button
                      type="button"
                      disabled={frameIndex === 0}
                      className="rounded border border-[#a58c79] px-[5px] disabled:opacity-35"
                      onClick={() => moveFrame(frameIndex, frameIndex - 1)}
                    >
                      前移
                    </button>
                    <button
                      type="button"
                      disabled={frameIndex === animationFrames.length - 1}
                      className="rounded border border-[#a58c79] px-[5px] disabled:opacity-35"
                      onClick={() => moveFrame(frameIndex, frameIndex + 1)}
                    >
                      后移
                    </button>
                    <button
                      type="button"
                      className="rounded border border-[#a56060] px-[5px] text-[#8b3f45]"
                      onClick={() =>
                        setAnimationFrames((currentFrames) =>
                          currentFrames.filter((currentFrame) => currentFrame.key !== frame.key),
                        )
                      }
                    >
                      移除
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <button
            type="button"
            disabled={animationFrames.length === 0}
            className="rounded-[6px] bg-[#493247] px-[14px] py-[9px] font-fusion-pixel text-[#fff9ea] disabled:opacity-40"
            onClick={exportSpriteSheet}
          >
            导出 animation.png
          </button>
        </section>
      </aside>
    </div>
  );
}
