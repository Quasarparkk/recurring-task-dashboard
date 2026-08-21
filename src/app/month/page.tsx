/**
 * 월간 뷰 — 캘린더 / 리스트 토글
 */

import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";

import { FilterBar } from "@/components/filter-bar";
import { MonthCalendar } from "@/components/month-calendar";
import { OccurrenceList } from "@/components/occurrence-list";
import { StatusLegend } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { currentYearInSeoul, todayInSeoul } from "@/lib/date/kst";
import { getMonth } from "@/lib/date/plain-date";
import { getMonthlyView } from "@/lib/services/dashboard-service";
import { loadFilterOptions } from "@/lib/services/options-service";
import { parseOccurrenceFilter } from "@/lib/validation/task-schema";
import { cn } from "@/lib/utils";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MonthlyViewPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const today = todayInSeoul();
  const currentYear = currentYearInSeoul();

  const parsedYear = Number(single(params.year));
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
      ? parsedYear
      : currentYear;

  const parsedMonth = Number(single(params.month));
  const month =
    Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12
      ? parsedMonth
      : getMonth(today);

  const viewMode = single(params.view) === "list" ? "list" : "calendar";
  const filter = parseOccurrenceFilter(params);

  const [view, options] = await Promise.all([
    getMonthlyView(year, month, filter, { today }),
    loadFilterOptions(),
  ]);

  // 이전/다음 달 계산 (연 경계 처리)
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };

  const baseParams = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value) baseParams.set(key, String(value));
  }
  const linkTo = (target: { year: number; month: number }, mode = viewMode) => {
    const p = new URLSearchParams(baseParams);
    p.set("year", String(target.year));
    p.set("month", String(target.month));
    p.set("view", mode);
    return `/month?${p.toString()}`;
  };

  const summary = {
    total: view.occurrences.length,
    done: view.occurrences.filter((o) => o.derived.status === "DONE").length,
    overdue: view.occurrences.filter((o) => o.derived.status === "OVERDUE").length,
    blocked: view.occurrences.filter((o) => o.derived.status === "BLOCKED").length,
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-5">
      {/* ---------- 헤더 ---------- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <span className="tabular-nums">
              {year}년 {month}월
            </span>
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            총 {summary.total}건 · 완료 {summary.done}
            {summary.overdue > 0 && (
              <span className="text-status-overdue-fg"> · 지연 {summary.overdue}</span>
            )}
            {summary.blocked > 0 && (
              <span className="text-status-blocked-fg"> · 대기 {summary.blocked}</span>
            )}
            {view.holidays.length > 0 && (
              <span> · 공휴일 {view.holidays.length}일</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="icon" className="size-8">
              <Link href={linkTo(prev)} aria-label="이전 달">
                <ChevronLeft className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="icon" className="size-8">
              <Link href={linkTo(next)} aria-label="다음 달">
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          </div>

          {/* 뷰 모드 토글 */}
          <div className="flex overflow-hidden rounded-md border">
            {(["calendar", "list"] as const).map((mode) => (
              <Link
                key={mode}
                href={linkTo({ year, month }, mode)}
                className={cn(
                  "px-3 py-1.5 text-sm transition-colors",
                  viewMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent",
                )}
              >
                {mode === "calendar" ? "캘린더" : "리스트"}
              </Link>
            ))}
          </div>

          <Button asChild variant="outline" size="sm" className="h-8">
            <Link href={`/?year=${year}&${baseParams.toString()}`}>
              <LayoutGrid className="size-4" />
              연간 뷰
            </Link>
          </Button>
        </div>
      </div>

      {/* ---------- 월 선택 바 ---------- */}
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <Link
            key={m}
            href={linkTo({ year, month: m })}
            className={cn(
              "min-w-[3rem] rounded-md border px-2 py-1 text-center text-sm tabular-nums transition-colors",
              m === month
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-accent",
            )}
          >
            {m}월
          </Link>
        ))}
      </div>

      {/* ---------- 필터 + 범례 ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Suspense fallback={<div className="h-8" />}>
          <FilterBar options={options} />
        </Suspense>
        <StatusLegend />
      </div>

      {/* ---------- 본문 ---------- */}
      {viewMode === "calendar" ? (
        <MonthCalendar view={view} />
      ) : (
        <OccurrenceList
          occurrences={view.occurrences}
          emptyMessage="이 달에 예정된 업무가 없습니다. 필터를 확인해 보세요."
        />
      )}

      {/* ---------- 공휴일 목록 ---------- */}
      {view.holidays.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <h2 className="text-sm font-medium">이 달의 공휴일·휴무일</h2>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {view.holidays.map((holiday) => (
              <li key={holiday.date} className="text-xs">
                <span className="font-medium tabular-nums text-holiday-fg">
                  {holiday.date.slice(5).replace("-", "/")}
                </span>
                <span className="ml-1.5 text-muted-foreground">{holiday.name}</span>
                {holiday.type === "COMPANY" && (
                  <span className="ml-1 rounded bg-muted px-1 text-[10px]">사내</span>
                )}
                {holiday.type === "SUBSTITUTE" && (
                  <span className="ml-1 rounded bg-muted px-1 text-[10px]">대체</span>
                )}
                {holiday.type === "TEMPORARY" && (
                  <span className="ml-1 rounded bg-muted px-1 text-[10px]">임시</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
