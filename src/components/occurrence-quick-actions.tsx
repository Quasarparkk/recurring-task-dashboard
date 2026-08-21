"use client";

/**
 * 발생 건 빠른 상태 변경 (목록에서 바로 완료 처리)
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, MoreHorizontal, Play, RotateCcw, SkipForward } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { StoredOccurrenceStatus } from "@/lib/dependency/status";

export function OccurrenceQuickActions({
  occurrenceId,
  status,
}: {
  occurrenceId: string;
  status: StoredOccurrenceStatus;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const setStatus = async (next: StoredOccurrenceStatus) => {
    setIsPending(true);
    try {
      const response = await fetch(`/api/occurrences/${occurrenceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const json = await response.json();

      if (!response.ok) {
        toast.error(json.error ?? "상태를 변경할 수 없습니다.");
        return;
      }

      toast.success(json.message ?? STATUS_MESSAGE[next]);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "네트워크 오류가 발생했습니다.",
      );
    } finally {
      setIsPending(false);
    }
  };

  const isTerminal = status === "DONE" || status === "SKIPPED";

  return (
    <div className="flex items-center gap-0.5">
      {!isTerminal && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-status-done-fg"
          disabled={isPending}
          onClick={() => void setStatus("DONE")}
          title="완료 처리"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            disabled={isPending}
            title="상태 변경"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-44">
          {status !== "IN_PROGRESS" && (
            <DropdownMenuItem onClick={() => void setStatus("IN_PROGRESS")}>
              <Play className="size-4" />
              진행중으로 표시
            </DropdownMenuItem>
          )}
          {status !== "DONE" && (
            <DropdownMenuItem onClick={() => void setStatus("DONE")}>
              <Check className="size-4" />
              완료 처리
            </DropdownMenuItem>
          )}
          {status !== "SKIPPED" && (
            <DropdownMenuItem onClick={() => void setStatus("SKIPPED")}>
              <SkipForward className="size-4" />
              건너뜀으로 표시
            </DropdownMenuItem>
          )}
          {status !== "PENDING" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void setStatus("PENDING")}>
                <RotateCcw className="size-4" />
                예정으로 되돌리기
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const STATUS_MESSAGE: Record<StoredOccurrenceStatus, string> = {
  DONE: "완료 처리했습니다.",
  IN_PROGRESS: "진행중으로 변경했습니다.",
  SKIPPED: "건너뜀으로 표시했습니다.",
  PENDING: "예정으로 되돌렸습니다.",
};
