/**
 * POST /api/tasks — 업무 등록
 */

import type { NextRequest } from "next/server";

import { handle } from "@/lib/api/respond";
import { createTask } from "@/lib/services/task-service";
import { taskInputSchema } from "@/lib/validation/task-schema";

export async function POST(request: NextRequest) {
  return handle(
    async () => {
      const body = await request.json();
      const input = taskInputSchema.parse(body);
      const task = await createTask(input);
      return { id: task.id };
    },
    { successStatus: 201 },
  );
}
