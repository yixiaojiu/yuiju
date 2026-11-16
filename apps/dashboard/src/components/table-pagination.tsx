"use client";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@yuiju/shared/ui/components/pagination";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** 只展示服务端返回的分页状态，翻页交由页面发起查询。 */
export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // 少量页码完整展示；较多时保留首尾和当前页附近，只有一页的间隔直接展开。
  const visiblePages =
    pageCount <= 7
      ? Array.from({ length: pageCount }, (_, index) => index + 1)
      : [...new Set([1, page - 1, page, page + 1, pageCount])].filter(
          (number) => number >= 1 && number <= pageCount,
        );
  const items: (number | string)[] = [];
  for (const [index, number] of visiblePages.entries()) {
    if (index > 0) {
      const previous = visiblePages[index - 1];
      if (number - previous === 2) {
        items.push(previous + 1);
      } else if (number - previous > 2) {
        items.push(`ellipsis-${previous}`);
      }
    }
    items.push(number);
  }

  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5">
      <span className="text-xs text-muted-foreground tabular-nums">共 {total} 条</span>
      {pageCount > 1 && (
        <Pagination className="mx-0 w-auto max-w-full">
          <PaginationContent className="flex-wrap gap-0.5">
            <PaginationItem>
              <PaginationLink
                size="icon-sm"
                aria-label="上一页"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
              >
                <ChevronLeft />
              </PaginationLink>
            </PaginationItem>
            {items.map((item) => (
              <PaginationItem key={item}>
                {typeof item === "number" ? (
                  <PaginationLink
                    size="icon-sm"
                    aria-label={`第 ${item} 页`}
                    isActive={item === page}
                    disabled={item === page}
                    className="text-xs tabular-nums data-[active=true]:border-primary data-[active=true]:bg-accent disabled:opacity-100"
                    onClick={() => onPageChange(item)}
                  >
                    {item}
                  </PaginationLink>
                ) : (
                  <PaginationEllipsis className="size-8" />
                )}
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationLink
                size="icon-sm"
                aria-label="下一页"
                disabled={page >= pageCount}
                onClick={() => onPageChange(page + 1)}
              >
                <ChevronRight />
              </PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </footer>
  );
}
