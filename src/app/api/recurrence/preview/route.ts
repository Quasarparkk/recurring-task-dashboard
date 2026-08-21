/**
 * POST /api/recurrence/preview
 * ============================================================================
 * "다음 N회 발생 예정일" 미리보기.
 *
 * 업무 등록/수정 폼에서 반복 규칙을 바꿀 때마다 호출되어 결과를 즉시 보여준다.
 * 이 기능이 사용성의 핵심이므로 응답을 최대한 가볍게 유지한다.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import { todayInSeoul } from "@/lib/date/kst";
import { handle } from "@/lib/api/respond";
import { describeConfig } from "@/lib/recurrence/describe";
import { previewNextOccurrences } from "@/lib/recurrence/engine";
import { plainDateSchema, recurrenceConfigSchema } from "@/lib/recurrence/types";
import { getHolidayCalendar } from "@/lib/services/holiday-service";

const requestSchema = z.object({
  config: recurrenceConfigSchema,
  /** 미리보기 개수. 기본 10회 */
  count: z.number().int().min(1).max(50).default(10),
  /** 기준일. 생략 시 오늘 */
  from: plainDateSchema.optional(),
  /** true 면 시작일부터 (과거 회차 포함) 보여준다 */
  fromStartDate: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  return handle(async () => {
    const body = await request.json();
    const { config, count, from, fromStartDate } = requestSchema.parse(body);

    const calendar = await getHolidayCalendar();
    const today = todayInSeoul();
    const baseDate = fromStartDate ? config.startDate : (from ?? today);

    const occurrences = previewNextOccurrences(config, calendar, count, baseDate);

    return {
      description: describeConfig(config),
      baseDate,
      today,
      occurrences: occurrences.map((occurrence) => ({
        sequenceIndex: occurrence.sequenceIndex,
        originalDate: occurrence.originalDate,
        scheduledDate: occurrence.scheduledDate,
        shiftReason: occurrence.shiftReason,
        // 공휴일 이름을 함께 내려 사용자가 왜 날짜가 옮겨졌는지 알 수 있게 한다.
        holidayName:
          occurrence.originalDate !== occurrence.scheduledDate
            ? calendar.getHolidayName(occurrence.originalDate)
            : null,
        isWeekendOriginal: calendar.isWeekend(occurrence.originalDate),
      })),
      /** 요청한 개수보다 적으면 반복이 끝났다는 뜻 */
      isExhausted: occurrences.length < count,
    };
  });
}
