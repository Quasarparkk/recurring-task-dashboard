/**
 * PATCH  /api/dependencies/[id] — 의존 관계 설정 변경 (lag, 매칭 전략 등)
 * DELETE /api/dependencies/[id] — 의존 관계 해제
 */

import type { NextRequest } from "next/server";

import { handle } from "@/lib/api/respond";
import {
  deleteTaskDependency,
  updateTaskDependency,
} from "@/lib/services/task-service";
import { taskDependencyInputSchema } from "@/lib/validation/task-schema";

type Params = { params: Promise<{ id: string }> };

/** 선행/후행 자체는 변경할 수 없다 (변경 = 삭제 후 재등록). */
const patchSchema = taskDependencyInputSchema
  .omit({ predecessorId: true, successorId: true })
  .partial();

export async function PATCH(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = await request.json();
    const input = patchSchema.parse(body);
    await updateTaskDependency(id, input);
    return { id };
  });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    await deleteTaskDependency(id);
    return { id, deleted: true };
  });
}
