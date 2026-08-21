/**
 * GET /api/notifications/unread
 * ============================================================================
 * WEB_PUSH 채널로 발송된 알림 중 아직 브라우저에 표시되지 않은 것을 반환한다.
 * NotificationWatcher 컴포넌트가 주기적으로 호출한다.
 */

import { handle } from "@/lib/api/respond";
import { prisma } from "@/lib/db";

/** 한 번에 표시할 최대 개수. 이보다 많으면 오래된 것은 조용히 읽음 처리된다. */
const MAX_ITEMS = 8;

export async function GET() {
  return handle(async () => {
    const rows = await prisma.notificationLog.findMany({
      where: {
        channel: "WEB_PUSH",
        status: "SENT",
        readAt: null,
      },
      orderBy: { plannedAt: "desc" },
      take: MAX_ITEMS,
      select: {
        id: true,
        title: true,
        body: true,
        kind: true,
        plannedAt: true,
        occurrenceId: true,
        occurrence: { select: { taskId: true } },
      },
    });

    return {
      notifications: rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        kind: row.kind,
        plannedAt: row.plannedAt.toISOString(),
        occurrenceId: row.occurrenceId,
        taskId: row.occurrence.taskId,
      })),
    };
  });
}
