"use client";

import type { HomeResponse } from "@/app/api/nodejs/[[...route]]/home";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type HomeStatus = {
  behavior?: string;
  location?: string;
  stamina?: { current?: number; max?: number };
  satiety?: number;
  mood?: number;
  money?: number;
  phoneBattery?: number;
};

type InventoryItem = {
  name: string;
  count: number;
};

type HomeStatusCardProps = {
  status?: HomeStatus;
  todayActions?: string[];
  inventory?: InventoryItem[];
  plans?: HomeResponse["data"]["plans"];
};

// 关键函数：格式化背包条目，保证文案一致。
const formatItem = (item: InventoryItem) => `${item.name} ×${item.count}`;

export function HomeStatusCard({ status, todayActions, inventory, plans }: HomeStatusCardProps) {
  const displayStatus = status;
  const displayActions = todayActions ?? [];
  const displayInventory = inventory ?? [];
  const displayPlans = plans;
  const inventorySummary =
    displayInventory.length > 0 ? displayInventory.map(formatItem).join(" · ") : "暂无";

  return (
    <Card>
      <div className="p-[14px] grid gap-[14px]">
        <div className="flex items-center justify-between gap-[10px]">
          <h3 className="m-0 text-[14px] font-black tracking-[0.2px]">角色状态</h3>
          <Button type="button">刷新</Button>
        </div>

        <div className="grid grid-cols-2 gap-[10px] mt-[10px] max-[520px]:grid-cols-1">
          <div className="rounded-xl bg-[rgba(247,251,255,0.8)] border border-[rgba(217,230,245,0.8)] p-[10px]">
            <div className="text-xs text-[#6b7480]">当前行为</div>
            <div className="mt-1.5 text-sm font-extrabold">{displayStatus?.behavior ?? "—"}</div>
          </div>
          <div className="rounded-xl bg-[rgba(247,251,255,0.8)] border border-[rgba(217,230,245,0.8)] p-[10px]">
            <div className="text-xs text-[#6b7480]">当前位置</div>
            <div className="mt-1.5 text-sm font-extrabold">{displayStatus?.location ?? "—"}</div>
          </div>
          <div className="rounded-xl bg-[rgba(247,251,255,0.8)] border border-[rgba(217,230,245,0.8)] p-[10px]">
            <div className="text-xs text-[#6b7480]">体力</div>
            <div className="mt-1.5 text-sm font-extrabold">
              {displayStatus?.stamina?.current ?? "—"}
              <span className="text-[#6b7480]"> / {displayStatus?.stamina?.max ?? "—"}</span>
            </div>
          </div>
          <div className="rounded-xl bg-[rgba(247,251,255,0.8)] border border-[rgba(217,230,245,0.8)] p-[10px]">
            <div className="text-xs text-[#6b7480]">饱腹度</div>
            <div className="mt-1.5 text-sm font-extrabold">
              {displayStatus?.satiety ?? "—"}
              <span className="text-[#6b7480]"> / 100</span>
            </div>
          </div>
          <div className="rounded-xl bg-[rgba(247,251,255,0.8)] border border-[rgba(217,230,245,0.8)] p-[10px]">
            <div className="text-xs text-[#6b7480]">心情</div>
            <div className="mt-1.5 text-sm font-extrabold">
              {displayStatus?.mood ?? "—"}
              <span className="text-[#6b7480]"> / 100</span>
            </div>
          </div>
          <div className="rounded-xl bg-[rgba(247,251,255,0.8)] border border-[rgba(217,230,245,0.8)] p-[10px]">
            <div className="text-xs text-[#6b7480]">金钱</div>
            <div className="mt-1.5 text-sm font-extrabold">¥ {displayStatus?.money ?? "—"}</div>
          </div>
          <div className="rounded-xl bg-[rgba(247,251,255,0.8)] border border-[rgba(217,230,245,0.8)] p-[10px]">
            <div className="text-xs text-[#6b7480]">手机电量</div>
            <div className="mt-1.5 text-sm font-extrabold">
              {displayStatus?.phoneBattery ?? "—"}
              <span className="text-[#6b7480]">%</span>
            </div>
          </div>
        </div>

        <div className="mt-[10px] p-3 rounded-2xl border border-[rgba(217,230,245,0.85)] bg-[rgba(247,251,255,0.85)] grid gap-2.5">
          <div className="flex items-center justify-between gap-[10px]">
            <div className="text-xs font-black tracking-[0.2px] text-[#6b7480]">
              今日已执行的行为
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {displayActions.length > 0 ? (
              displayActions.map((item) => (
                <Badge key={item} variant="chip" size="sm">
                  {item}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-[#6b7480]">暂无</span>
            )}
          </div>
        </div>

        <div className="mt-[10px] p-3 rounded-2xl border border-[rgba(217,230,245,0.85)] bg-[rgba(247,251,255,0.85)] grid gap-2.5">
          <div className="flex items-center justify-between gap-[10px]">
            <div className="text-xs font-black tracking-[0.2px] text-[#6b7480]">背包</div>
            <div className="text-[#6b7480] text-xs leading-[1.5]">{inventorySummary}</div>
          </div>
          <details className="border-t border-dashed border-[rgba(175,122,197,0.24)] pt-[10px]">
            <summary className="cursor-pointer select-none text-[#6b7480] text-xs list-none [&::-webkit-details-marker]:hidden">
              展开全部
            </summary>
            <div className="flex flex-wrap gap-2 mt-[10px]">
              {displayInventory.length > 0 ? (
                displayInventory.map((item) => (
                  <Badge key={item.name} variant="chip" size="sm">
                    {formatItem(item)}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-[#6b7480]">暂无</span>
              )}
            </div>
          </details>
        </div>

        <div className="mt-[12px] grid gap-3">
          <div className="grid gap-2 rounded-xl bg-[rgba(247,251,255,0.8)] border border-[rgba(217,230,245,0.8)] p-[10px]">
            <div className="text-xs text-[#6b7480]">长期计划</div>
            <p className="m-0 text-[#6b7480] text-[13px] leading-[1.55]">
              {displayPlans?.longTerm?.title ?? "—"}
            </p>
            {displayPlans?.longTerm && (
              <div className="text-xs text-[#6b7480] leading-[1.6]">
                <div>创建时间：{displayPlans.longTerm.createdAt}</div>
                {displayPlans.longTerm.updatedAt && (
                  <div>更新时间：{displayPlans.longTerm.updatedAt}</div>
                )}
              </div>
            )}
          </div>
          <div className="grid gap-2 rounded-xl bg-[rgba(247,251,255,0.8)] border border-[rgba(217,230,245,0.8)] p-[10px]">
            <div className="text-xs text-[#6b7480]">短期计划</div>
            {displayPlans?.shortTerm && displayPlans.shortTerm.length > 0 ? (
              <ul className="m-0 pl-[18px] space-y-2 text-[#6b7480] text-[13px] leading-[1.6]">
                {displayPlans.shortTerm.map((item) => (
                  <li key={item.title}>
                    <div>{item.title}</div>
                    <div className="text-xs text-[#6b7480] leading-[1.6]">
                      <div>创建时间：{item.createdAt}</div>
                      {item.updatedAt && <div>更新时间：{item.updatedAt}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-[13px] text-[#6b7480]">暂无</span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
