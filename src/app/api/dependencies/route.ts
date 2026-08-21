/**
 * POST /api/dependencies — 의존 관계 등록
 *
 * 순환 참조가 발생하면 409 와 함께 경로가 담긴 메시지를 반환한다.
 * (lib/api/respond.ts 의 DependencyCycleError 처리 참고)
 */

import type { NextRequest } from "next/server";

import { handle } from "@/lib/api/respond";
import { createTaskDependency } from "@/lib/services/task-service";
import { taskDependencyInputSchema } from "@/lib/validation/task-schema";

export async function POST(request: NextRequest) {
  return handle(
    async () => {
      const body = await request.json();
      const input = taskDependencyInputSchema.parse(body);

      if (input.predecessorId === input.successorId) {
        throw new Error("같은 업무를 선행과 후행으로 동시에 지정할 수 없습니다.");
      }

      const created = await createTaskDependency(input);
      return { id: created.id };
    },
    { successStatus: 201 },
  );
}
