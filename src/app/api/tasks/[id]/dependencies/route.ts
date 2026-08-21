/**
 * GET /api/tasks/[id]/dependencies — 이 업무와 연결된 의존 관계 목록
 * (연결 해제 다이얼로그에서 사용)
 */

import { handle } from "@/lib/api/respond";
import { prisma } from "@/lib/db";
import { MATCH_STRATEGY_LABELS } from "@/lib/dependency/status";
import { LAG_UNIT_LABELS } from "@/lib/validation/task-schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;

    const rows = await prisma.taskDependency.findMany({
      where: { OR: [{ predecessorId: id }, { successorId: id }] },
      include: {
        predecessor: { select: { id: true, title: true } },
        successor: { select: { id: true, title: true } },
      },
    });

    return {
      links: rows.map((row) => {
        const isPredecessorSide = row.successorId === id;
        const otherTitle = isPredecessorSide
          ? row.predecessor.title
          : row.successor.title;
        const arrow = isPredecessorSide ? "→ 이 업무" : "이 업무 →";

        const lagText =
          row.lagAmount > 0
            ? ` (+${row.lagAmount}${
                LAG_UNIT_LABELS[row.lagUnit as keyof typeof LAG_UNIT_LABELS] ?? "일"
              })`
            : "";

        const strategyText =
          MATCH_STRATEGY_LABELS[
            row.matchStrategy as keyof typeof MATCH_STRATEGY_LABELS
          ] ?? row.matchStrategy;

        return {
          id: row.id,
          label: isPredecessorSide
            ? `${otherTitle} ${arrow}${lagText} · ${strategyText}`
            : `${arrow} ${otherTitle}${lagText} · ${strategyText}`,
        };
      }),
    };
  });
}
