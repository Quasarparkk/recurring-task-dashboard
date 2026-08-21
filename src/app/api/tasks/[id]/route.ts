/**
 * PUT    /api/tasks/[id] — 업무 수정
 * PATCH  /api/tasks/[id] — 보관/활성 전환
 * DELETE /api/tasks/[id] — 업무 삭제
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import { handle } from "@/lib/api/respond";
import { deleteTask, setTaskActive, updateTask } from "@/lib/services/task-service";
import { taskInputSchema } from "@/lib/validation/task-schema";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = await request.json();
    const input = taskInputSchema.parse(body);
    await updateTask(id, input);
    return { id };
  });
}

const patchSchema = z.object({ isActive: z.boolean() });

export async function PATCH(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = await request.json();
    const { isActive } = patchSchema.parse(body);
    await setTaskActive(id, isActive);
    return { id, isActive };
  });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    await deleteTask(id);
    return { id, deleted: true };
  });
}
