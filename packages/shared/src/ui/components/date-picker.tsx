"use client";

import { Button } from "@yuiju/shared/ui/components/button";
import { Calendar } from "@yuiju/shared/ui/components/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@yuiju/shared/ui/components/popover";
import { cn } from "@yuiju/shared/ui/utils";
import dayjs, { type Dayjs } from "dayjs";
import { CalendarIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { zhCN } from "react-day-picker/locale";

const DATE_FORMAT = "YYYY-MM-DD";

/** 所在周的周一。 */
function startOfWeek(date: Dayjs) {
  return date.subtract((date.day() + 6) % 7, "day");
}

/** 触发器文本：今年省略年份，同月省略结束月份，单日只显示一天。 */
function formatDateRange(startDate: string, endDate: string) {
  const start = dayjs(startDate);
  const end = dayjs(endDate);
  const startText = start.format(start.year() === dayjs().year() ? "M月D日" : "YYYY年M月D日");
  if (startDate === endDate) {
    return startText;
  }
  const endText = end.format(
    end.year() !== start.year() ? "YYYY年M月D日" : end.month() !== start.month() ? "M月D日" : "D日",
  );
  return `${startText} – ${endText}`;
}

/** 两种选择器共用的触发按钮与弹层：md 以上快捷项在日历左侧竖排，窄屏在日历上方横排。 */
function PickerPopover({
  id,
  label,
  text,
  open,
  onOpenChange,
  presets,
  children,
}: {
  id: string;
  label: string;
  /** null 表示未选择，显示占位文本。 */
  text: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: { label: string; active: boolean; onSelect: () => void }[];
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-label={`${label}：${text ?? "未选择"}`}
          className={cn(
            "h-9 w-full min-w-0 justify-start rounded-lg bg-background px-3 font-normal text-foreground",
            text === null && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="text-muted-foreground" />
          <span className="truncate">{text ?? `选择${label}`}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-auto flex-col p-0 md:flex-row"
        aria-label={label}
      >
        <div className="flex flex-wrap gap-1 border-b p-2 md:w-28 md:flex-col md:flex-nowrap md:border-r md:border-b-0">
          {presets.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={preset.active}
              className={cn(
                "justify-start font-normal",
                preset.active && "bg-accent font-medium text-accent-foreground",
              )}
              onClick={() => {
                preset.onSelect();
                onOpenChange(false);
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div>{children}</div>
      </PopoverContent>
    </Popover>
  );
}

/** 日期按浏览器本地自然日读写；只把完整范围提交给筛选草稿，中途关闭不改变原值。 */
export function DateRangePicker({
  id,
  value,
  onChange,
  required = false,
}: {
  id: string;
  value: { startDate: string; endDate: string };
  onChange: (value: { startDate: string; endDate: string }) => void;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** 日历内尚未选完的范围，与外部已提交的筛选草稿分开。 */
  const [range, setRange] = useState<DateRange>();
  const [numberOfMonths, setNumberOfMonths] = useState(1);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const updateMonths = () => setNumberOfMonths(media.matches ? 2 : 1);
    updateMonths();
    media.addEventListener("change", updateMonths);
    return () => media.removeEventListener("change", updateMonths);
  }, []);

  const today = dayjs();
  const weekStart = startOfWeek(today);
  const lastMonth = today.subtract(1, "month");
  const presets = [
    { label: "今天", start: today, end: today },
    { label: "昨天", start: today.subtract(1, "day"), end: today.subtract(1, "day") },
    { label: "近 7 天", start: today.subtract(6, "day"), end: today },
    { label: "近 30 天", start: today.subtract(29, "day"), end: today },
    { label: "本周", start: weekStart, end: weekStart.add(6, "day") },
    { label: "本月", start: today.startOf("month"), end: today.endOf("month") },
    { label: "上月", start: lastMonth.startOf("month"), end: lastMonth.endOf("month") },
  ].map(({ label, start, end }) => {
    const startDate = start.format(DATE_FORMAT);
    const endDate = end.format(DATE_FORMAT);
    return {
      label,
      active: value.startDate === startDate && value.endDate === endDate,
      onSelect: () => onChange({ startDate, endDate }),
    };
  });

  return (
    <PickerPopover
      id={id}
      label="日期范围"
      text={value.startDate ? formatDateRange(value.startDate, value.endDate) : null}
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setRange(
            value.startDate
              ? {
                  from: dayjs(value.startDate).toDate(),
                  to: dayjs(value.endDate).toDate(),
                }
              : undefined,
          );
        }
        setOpen(nextOpen);
      }}
      presets={presets}
    >
      <Calendar
        mode="range"
        required
        resetOnSelect
        locale={zhCN}
        selected={range}
        defaultMonth={range?.from}
        numberOfMonths={numberOfMonths}
        autoFocus
        onSelect={(nextRange) => {
          setRange(nextRange);
          if (nextRange.from && nextRange.to) {
            onChange({
              startDate: dayjs(nextRange.from).format(DATE_FORMAT),
              endDate: dayjs(nextRange.to).format(DATE_FORMAT),
            });
            setOpen(false);
          }
        }}
      />
      {!required && (
        <div className="border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={!value.startDate}
            onClick={() => {
              onChange({ startDate: "", endDate: "" });
              setOpen(false);
            }}
          >
            清空
          </Button>
        </div>
      )}
    </PickerPopover>
  );
}

/**
 * 周选择：周一开始，弹层高亮 value 所在的整周；点任一天即提交该日期并关闭。
 * value/onChange 是周内任一日期（YYYY-MM-DD），调用方可据此保留周内选中日。
 */
export function WeekPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const weekStart = startOfWeek(dayjs(value));
  const weekEnd = weekStart.add(6, "day");
  const today = dayjs();
  const presets = [
    { label: "本周", date: today },
    { label: "上周", date: today.subtract(7, "day") },
    { label: "下周", date: today.add(7, "day") },
  ].map(({ label, date }) => ({
    label,
    active: startOfWeek(date).isSame(weekStart, "day"),
    onSelect: () => onChange(date.format(DATE_FORMAT)),
  }));

  return (
    <PickerPopover
      id={id}
      label="周"
      text={formatDateRange(weekStart.format(DATE_FORMAT), weekEnd.format(DATE_FORMAT))}
      open={open}
      onOpenChange={setOpen}
      presets={presets}
    >
      <Calendar
        mode="range"
        required
        locale={zhCN}
        selected={{ from: weekStart.toDate(), to: weekEnd.toDate() }}
        defaultMonth={weekStart.toDate()}
        autoFocus
        onSelect={(_range, day) => {
          onChange(dayjs(day).format(DATE_FORMAT));
          setOpen(false);
        }}
      />
    </PickerPopover>
  );
}
