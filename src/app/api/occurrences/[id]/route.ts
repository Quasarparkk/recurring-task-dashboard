/**
 * PATCH /api/occurrences/[id] — 발생 건 수정 (상태/담당자/메모/마감일)
 */

import type { NextRequest } from "next/server";

import { handle } from "@/lib/api/respond";
import { updateOccurrence } from "@/lib/services/occurrence-mutation-service";
import { occurrenceUpdateSchema } from "@/lib/validation/task-schema";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = await request.json();
    const input = occurrenceUpdateSchema.parse(body);

    const result = await updateOccurrence(id, input);

    return {
      ...result,
      // 후행 알림이 발송되었으면 사용자에게 알려 준다.
      message:
        result.unblockedCount > 0
          ? `완료 처리했습니다. 후행 업무 ${result.unblockedCount}건의 담당자에게 알림을 보냈습니다.`
          : null,
    };
  });
}
