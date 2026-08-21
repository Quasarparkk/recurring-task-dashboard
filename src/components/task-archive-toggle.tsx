"use client";

/**
 * 업무 보관/활성 전환 + 삭제
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TaskArchiveToggle({
  taskId,
  isActive,
}: {
  taskId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const toggle = async () => {
    setIsPending(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      if (!response.ok) {
        const json = await response.json();
        toast.error(json.error ?? "상태를 변경할 수 없습니다.");
        return;
      }
      toast.success(
        isActive
          ? "보관 처리했습니다. 신규 회차 생성이 중지되며 기존 이력은 유지됩니다."
          : "활성화했습니다. 다음 배치에서 회차가 다시 생성됩니다.",
      );
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  const remove = async () => {
    setIsPending(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      if (!response.ok) {
        const json = await response.json();
        toast.error(json.error ?? "삭제할 수 없습니다.");
        return;
      }
      toast.success("업무를 삭제했습니다.");
      router.push("/");
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => void toggle()} disabled={isPending}>
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isActive ? (
          <Archive className="size-4" />
        ) : (
          <ArchiveRestore className="size-4" />
        )}
        {isActive ? "보관" : "활성화"}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-status-overdue-fg"
        onClick={() => setDeleteOpen(true)}
        title="업무 삭제"
      >
        <Trash2 className="size-4" />
      </Button>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>업무를 삭제하시겠습니까?</DialogTitle>
            <DialogDescription>
              이 업무의 <strong>모든 발생 이력, 체크리스트, 알림 기록</strong>이 함께
              삭제되며 복구할 수 없습니다.
              <br />
              <br />
              과거 기록을 남기려면 삭제 대신 <strong>보관</strong>을 사용하세요. 보관하면
              신규 회차 생성만 멈추고 이력은 그대로 유지됩니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-delete" className="text-xs">
              확인을 위해 <code className="rounded bg-muted px-1">삭제</code> 를 입력하세요
            </Label>
            <Input
              id="confirm-delete"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="삭제"
              autoComplete="off"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              취소
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText !== "삭제" || isPending}
              onClick={() => void remove()}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              영구 삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
