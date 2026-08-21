/**
 * PATCH /api/checklist/[id] — 체크리스트 항목 체크/해제
 */

import type { NextRequest } from "next/server";

import { handle } from "@/lib/api/respond";
import { setChecklistItemChecked } from "@/lib/services/occurrence-mutation-service";
import { checklistItemUpdateSchema } from "@/lib/validation/task-schema";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = await request.json();
    const { isChecked } = checklistItemUpdateSchema.parse(body);
    return setChecklistItemChecked(id, isChecked);
  });
}
