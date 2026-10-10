"use client";

import dayjs from "dayjs";
import { CalendarIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { zhCN } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

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
  const text = value.startDate ? `${value.startDate} — ${value.endDate}` : "选择日期范围";

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const updateMonths = () => setNumberOfMonths(media.matches ? 2 : 1);
    updateMonths();
    media.addEventListener("change", updateMonths);
    return () => media.removeEventListener("change", updateMonths);
  }, []);

  return (
    <Popover
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
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-label={`日期范围：${text}`}
          className={cn(
            "h-9 w-full min-w-0 justify-start rounded-lg bg-background px-3 font-normal text-foreground",
            !value.startDate && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="text-muted-foreground" />
          <span className="truncate">{text}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0" aria-label="日期范围">
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
                startDate: dayjs(nextRange.from).format("YYYY-MM-DD"),
                endDate: dayjs(nextRange.to).format("YYYY-MM-DD"),
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
      </PopoverContent>
    </Popover>
  );
}
