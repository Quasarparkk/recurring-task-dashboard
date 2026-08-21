/**
 * 공휴일 서비스 — DB 의 Holiday 테이블 → HolidayCalendar 변환
 * ============================================================================
 *
 * 계산 로직(business-day.ts)은 공휴일을 주입받기만 하므로,
 * DB 조회와 캐싱은 이 계층이 담당한다.
 */

import { createHolidayCalendar, type HolidayCalendar } from "@/lib/date/business-day";
import type { PlainDate } from "@/lib/date/plain-date";
import { prisma } from "@/lib/db";

/**
 * 프로세스 내 캐시.
 * 공휴일 데이터는 거의 바뀌지 않으므로 요청마다 조회할 필요가 없다.
 * 데이터가 갱신되면 `invalidateHolidayCache()` 를 호출한다.
 */
let cachedCalendar: HolidayCalendar | null = null;
let cachedEntries: { date: PlainDate; name: string; type: string }[] | null = null;

export function invalidateHolidayCache(): void {
  cachedCalendar = null;
  cachedEntries = null;
}

/** DB 의 모든 공휴일을 읽어 달력을 만든다. */
export async function getHolidayCalendar(): Promise<HolidayCalendar> {
  if (cachedCalendar) return cachedCalendar;

  const entries = await loadHolidayEntries();
  cachedCalendar = createHolidayCalendar(
    entries.map((e) => ({ date: e.date, name: e.name })),
  );
  return cachedCalendar;
}

/** 공휴일 원본 목록 (관리 화면 표시용). */
export async function loadHolidayEntries() {
  if (cachedEntries) return cachedEntries;

  const rows = await prisma.holiday.findMany({
    orderBy: { date: "asc" },
    select: { date: true, name: true, type: true, year: true },
  });

  cachedEntries = rows.map((row) => ({
    date: row.date as PlainDate,
    name: row.name,
    type: row.type,
  }));
  return cachedEntries;
}

/** 특정 연도의 공휴일. */
export async function getHolidaysByYear(year: number) {
  return prisma.holiday.findMany({
    where: { year },
    orderBy: { date: "asc" },
  });
}

/** 공휴일 데이터가 등록된 연도 목록. 데이터 갱신 필요 여부 판단에 사용. */
export async function getHolidayCoverageYears(): Promise<number[]> {
  const rows = await prisma.holiday.findMany({
    distinct: ["year"],
    select: { year: true },
    orderBy: { year: "asc" },
  });
  return rows.map((r) => r.year);
}

/**
 * 공휴일 데이터가 부족한지 검사한다.
 * 롤링 윈도우가 커버하는 기간의 공휴일이 없으면 영업일 계산이 부정확해지므로
 * 대시보드에 경고를 띄우기 위한 함수다.
 */
export async function checkHolidayCoverage(
  requiredThroughYear: number,
): Promise<{ ok: boolean; missingYears: number[]; coveredYears: number[] }> {
  const covered = await getHolidayCoverageYears();
  const coveredSet = new Set(covered);

  const currentYear = covered.length > 0 ? Math.min(...covered) : requiredThroughYear;
  const missingYears: number[] = [];
  for (let year = currentYear; year <= requiredThroughYear; year += 1) {
    if (!coveredSet.has(year)) missingYears.push(year);
  }

  return { ok: missingYears.length === 0, missingYears, coveredYears: covered };
}
