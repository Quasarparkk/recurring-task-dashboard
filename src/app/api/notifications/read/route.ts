/**
 * POST /api/notifications/read — 알림 읽음 처리
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import { handle } from "@/lib/api/respond";
import { prisma } from "@/lib/db";

const requestSchema = z.object({
  /** 비우면 WEB_PUSH 미읽음 전체를 읽음 처리한다. */
  ids: z.array(z.string().min(1)).max(200).optional(),
});

export async function POST(request: NextRequest) {
  return handle(async () => {
    const body = await request.json().catch(() => ({}));
    const { ids } = requestSchema.parse(body);

    const result = await prisma.notificationLog.updateMany({
      where: ids?.length
        ? { id: { in: ids }, readAt: null }
        : { channel: "WEB_PUSH", readAt: null },
      data: { readAt: new Date() },
    });

    return { updated: result.count };
  });
}
