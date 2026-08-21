/**
 * 연간 대시보드 (메인)
 * ============================================================================
 * 12개월 × 업무 그리드. 이 앱의 핵심 화면이다.
 */

import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, CalendarDays } from "lucide-react";

import { FilterBar } from "@/components/filter-bar";
import { StatusLegend } from "@/components/status-badge";
import { SummaryCards } from "@/components/summary-cards";
import { YearGrid } from "@/components/year-grid";
import { YearSwitcher } from "@/components/year-switcher";
import { Button } from "@/components/ui/button";
import { currentYearInSeoul, todayInSeoul } from "@/lib/date/kst";
import { getYearlyDashboard } from "@/lib/services/dashboard-service";
import { checkHolidayCoverage } from "@/lib/services/holiday-service";
import { loadFilterOptions } from "@/lib/services/options-service";
import { parseOccurrenceFilter } from "@/lib/validation/task-schema";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function YearlyDashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const today = todayInSeoul();
  const currentYear = currentYearInSeoul();

  const yearParam = Array.isArray(params.year) ? params.year[0] : params.year;
  const parsedYear = Number(yearParam);
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
      ? parsedYear
      : currentYear;

  const filter = parseOccurrenceFilter(params);

  const [dashboard, options, coverage] = await Promise.all([
    getYearlyDashboard(year, filter, { today }),
    loadFilterOptions(),
    // 롤링 윈도우 끝 연도까지 공휴일이 있는지 확인 (영업일 계산 정확성)
    checkHolidayCoverage(year + 1),
  ]);

  // 필터 상태를 유지하며 월간 뷰로 이동하기 위한 쿼리스트링
  const filterQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value) filterQuery.set(key, String(value));
  }

  return (
    <div className="mx-auto max-w-[1800px] space-y-4 px-4 py-5">
      {/* ---------- 헤더 ---------- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">연간 대시보드</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            반복 업무 {dashboard.rows.length}건 · 발생 회차 {dashboard.summary.total}건
            <span className="mx-1.5">·</span>
            오늘 {today}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Suspense fallback={<div className="h-8 w-48" />}>
            <YearSwitcher year={year} currentYear={currentYear} />
          </Suspense>
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link href={`/month?year=${year}&${filterQuery.toString()}`}>
              <CalendarDays className="size-4" />
              월간 뷰
            </Link>
          </Button>
        </div>
      </div>

      {/* ---------- 공휴일 데이터 경고 ---------- */}
      {!coverage.ok && (
        <div className="flex items-start gap-2 rounded-lg border border-status-blocked-line/50 bg-status-blocked-bg/50 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-blocked-fg" />
          <div>
            <p className="font-medium text-status-blocked-fg">
              공휴일 데이터가 없는 연도가 있습니다: {coverage.missingYears.join(", ")}년
            </p>
            <p className="mt-0.5 text-muted-foreground">
              해당 기간의 영업일 계산이 주말만 반영한 부정확한 값이 됩니다.{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                data/holidays/&lt;연도&gt;.json
              </code>{" "}
              파일을 추가하고{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">npm run db:seed</code>{" "}
              를 실행하세요.{" "}
              <Link href="/settings" className="underline">
                설정에서 확인
              </Link>
            </p>
          </div>
        </div>
      )}

      {/* ---------- 요약 ---------- */}
      <SummaryCards summary={dashboard.summary} />

      {/* ---------- 필터 + 범례 ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Suspense fallback={<div className="h-8" />}>
          <FilterBar options={options} />
        </Suspense>
        <StatusLegend />
      </div>

      {/* ---------- 그리드 ---------- */}
      <YearGrid dashboard={dashboard} searchQuery={filterQuery.toString()} />

      <p className="text-xs text-muted-foreground">
        셀의 숫자는 마감일(월.일)이며, 괄호 숫자는 체크리스트 진행률입니다. 셀에 마우스를
        올리면 상태·담당자·선행 대기 정보를 볼 수 있고, 클릭하면 해당 월간 뷰로 이동합니다.
      </p>
    </div>
  );
}
