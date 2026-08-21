/**
 * POST /api/admin/jobs — 배치 수동 실행
 * ============================================================================
 * 설정 화면에서 "지금 실행" 버튼으로 호출한다.
 * cron 을 기다리지 않고 동작을 확인할 수 있어야 개발·운영 모두 편하다.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import { handle } from "@/lib/api/respond";
import {
  dispatchDueNotifications,
  formatDispatchSummary,
} from "@/lib/notification/dispatcher";
import {
  summarizeSyncResults,
  syncAllOccurrences,
} from "@/lib/services/occurrence-service";

const requestSchema = z.object({
  job: z.enum(["generate", "dispatch", "both"]),
});

export async function POST(request: NextRequest) {
  return handle(async () => {
    const body = await request.json();
    const { job } = requestSchema.parse(body);

    const messages: string[] = [];

    if (job === "generate" || job === "both") {
      const results = await syncAllOccurrences();
      messages.push(`회차 생성 — ${summarizeSyncResults(results)}`);

      const failed = results.filter((r) => r.error);
      for (const result of failed) {
        messages.push(`  실패: ${result.taskTitle} (${result.error})`);
      }
    }

    if (job === "dispatch" || job === "both") {
      const summary = await dispatchDueNotifications();
      messages.push(`알림 발송 — ${formatDispatchSummary(summary)}`);
      messages.push(...summary.details.map((detail) => `  ${detail}`));
    }

    return { messages };
  });
}
