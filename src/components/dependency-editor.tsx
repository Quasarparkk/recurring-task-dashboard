"use client";

/**
 * 의존 관계 추가/해제 UI
 * ============================================================================
 * 순환 참조가 발생하면 서버가 409 와 함께 경로가 담긴 메시지를 반환한다.
 * 그 메시지를 그대로 보여줘 사용자가 어떤 연결을 끊어야 하는지 알 수 있게 한다.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Unlink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MATCH_STRATEGY_LABELS, type MatchStrategy } from "@/lib/dependency/status";
import { LAG_UNIT_LABELS } from "@/lib/validation/task-schema";

interface TaskOption {
  id: string;
  title: string;
  isActive: boolean;
}

type Direction = "PREDECESSOR" | "SUCCESSOR";

export function DependencyEditor({
  taskId,
  taskTitle,
  taskOptions,
  existingPredecessorIds,
  existingSuccessorIds,
}: {
  taskId: string;
  taskTitle: string;
  taskOptions: TaskOption[];
  existingPredecessorIds: string[];
  existingSuccessorIds: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<Direction>("PREDECESSOR");
  const [otherTaskId, setOtherTaskId] = useState<string>("");
  const [lagAmount, setLagAmount] = useState(0);
  const [lagUnit, setLagUnit] = useState<"BUSINESS_DAY" | "CALENDAR_DAY">(
    "BUSINESS_DAY",
  );
  const [matchStrategy, setMatchStrategy] =
    useState<MatchStrategy>("NEAREST_PRECEDING");
  const [isBlocking, setIsBlocking] = useState(true);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cycleError, setCycleError] = useState<string | null>(null);

  // 이미 연결된 업무와 자기 자신은 후보에서 제외한다.
  const excluded = new Set([taskId, ...existingPredecessorIds, ...existingSuccessorIds]);
  const candidates = taskOptions.filter((option) => !excluded.has(option.id));

  const reset = () => {
    setOtherTaskId("");
    setLagAmount(0);
    setLagUnit("BUSINESS_DAY");
    setMatchStrategy("NEAREST_PRECEDING");
    setIsBlocking(true);
    setNote("");
    setCycleError(null);
  };

  const submit = async () => {
    if (!otherTaskId) {
      toast.error("연결할 업무를 선택하세요.");
      return;
    }

    setIsSubmitting(true);
    setCycleError(null);

    try {
      const response = await fetch("/api/dependencies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          predecessorId: direction === "PREDECESSOR" ? otherTaskId : taskId,
          successorId: direction === "PREDECESSOR" ? taskId : otherTaskId,
          lagAmount,
          lagUnit,
          matchStrategy,
          isBlocking,
          note: note.trim() || null,
        }),
      });

      const json = await response.json();

      if (!response.ok) {
        // 409 = 순환 참조. 메시지를 다이얼로그 안에 유지해 사용자가 읽을 수 있게 한다.
        if (response.status === 409) {
          setCycleError(json.error);
          return;
        }
        toast.error(json.error ?? "의존 관계를 등록할 수 없습니다.");
        return;
      }

      toast.success("의존 관계를 등록했습니다.");
      setOpen(false);
      reset();
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "네트워크 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Plus className="size-4" />
            선행/후행 업무 연결
          </Button>
        </DialogTrigger>

        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>의존 관계 등록</DialogTitle>
            <DialogDescription>
              &ldquo;{taskTitle}&rdquo; 과 다른 업무의 선후 관계를 등록합니다. 순환
              참조는 등록 시점에 차단됩니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* ---------- 방향 ---------- */}
            <div className="space-y-1.5">
              <Label className="text-xs">관계 방향</Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { value: "PREDECESSOR", label: "선택한 업무 → 이 업무", hint: "선행으로 추가" },
                    { value: "SUCCESSOR", label: "이 업무 → 선택한 업무", hint: "후행으로 추가" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDirection(option.value)}
                    className={
                      direction === option.value
                        ? "rounded-md border border-primary bg-primary/10 px-2.5 py-2 text-left text-xs"
                        : "rounded-md border px-2.5 py-2 text-left text-xs hover:bg-accent"
                    }
                  >
                    <span className="block font-medium">{option.label}</span>
                    <span className="text-muted-foreground">{option.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ---------- 대상 업무 ---------- */}
            <div className="space-y-1.5">
              <Label htmlFor="dep-task" className="text-xs">
                연결할 업무
              </Label>
              <Select value={otherTaskId} onValueChange={setOtherTaskId}>
                <SelectTrigger id="dep-task">
                  <SelectValue placeholder="업무 선택" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-muted-foreground">
                      연결할 수 있는 업무가 없습니다.
                    </div>
                  ) : (
                    candidates.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.title}
                        {!option.isActive && " (보관)"}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* ---------- lag ---------- */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dep-lag" className="text-xs">
                  선행 완료 후 지연 (lag)
                </Label>
                <Input
                  id="dep-lag"
                  type="number"
                  min={0}
                  max={365}
                  value={lagAmount}
                  onChange={(event) =>
                    setLagAmount(Math.max(0, Number(event.target.value) || 0))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dep-unit" className="text-xs">
                  단위
                </Label>
                <Select
                  value={lagUnit}
                  onValueChange={(v) =>
                    setLagUnit(v as "BUSINESS_DAY" | "CALENDAR_DAY")
                  }
                >
                  <SelectTrigger id="dep-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LAG_UNIT_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* ---------- 매칭 전략 ---------- */}
            <div className="space-y-1.5">
              <Label htmlFor="dep-strategy" className="text-xs">
                회차 매칭 방식
              </Label>
              <Select
                value={matchStrategy}
                onValueChange={(v) => setMatchStrategy(v as MatchStrategy)}
              >
                <SelectTrigger id="dep-strategy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    ["NEAREST_PRECEDING", "SAME_SEQUENCE", "SAME_PERIOD"] as const
                  ).map((strategy) => (
                    <SelectItem key={strategy} value={strategy}>
                      {MATCH_STRATEGY_LABELS[strategy]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {MATCH_STRATEGY_HINTS[matchStrategy]}
              </p>
            </div>

            {/* ---------- 차단 여부 ---------- */}
            <label className="flex items-start gap-2 rounded-md border p-2.5">
              <Checkbox
                checked={isBlocking}
                onCheckedChange={(checked) => setIsBlocking(checked === true)}
                className="mt-0.5"
              />
              <span className="text-xs">
                <span className="block font-medium">선행 미완료 시 후행을 대기 상태로 표시</span>
                <span className="text-muted-foreground">
                  끄면 그래프에만 표시되고 상태 계산에는 반영하지 않습니다 (참고용 연결).
                </span>
              </span>
            </label>

            {/* ---------- 메모 ---------- */}
            <div className="space-y-1.5">
              <Label htmlFor="dep-note" className="text-xs">
                메모 (선택)
              </Label>
              <Input
                id="dep-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="예: 급여대장이 확정되지 않으면 이체할 수 없다"
              />
            </div>

            {/* ---------- 순환 참조 에러 ---------- */}
            {cycleError && (
              <div className="rounded-md border border-status-overdue-line/50 bg-status-overdue-bg/50 p-3">
                <p className="whitespace-pre-line text-xs text-status-overdue-fg">
                  {cycleError}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
              취소
            </Button>
            <Button onClick={() => void submit()} disabled={isSubmitting || !otherTaskId}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              등록
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {(existingPredecessorIds.length > 0 || existingSuccessorIds.length > 0) && (
        <UnlinkMenu taskId={taskId} />
      )}
    </div>
  );
}

const MATCH_STRATEGY_HINTS: Record<MatchStrategy, string> = {
  NEAREST_PRECEDING:
    "후행 마감일 이전(같은 날 포함) 중 가장 가까운 선행 회차와 짝짓습니다. 주기가 달라도 안전한 기본값입니다.",
  SAME_SEQUENCE:
    "같은 회차 번호끼리 짝짓습니다. 두 업무의 반복 주기가 완전히 동일할 때만 사용하세요.",
  SAME_PERIOD:
    "같은 달에 속한 선행 회차와 짝짓습니다. 월 단위로 묶이는 업무에 적합합니다.",
};

/** 연결 해제 — 상세 화면의 표에서 개별 삭제하는 대신 목록에서 고르게 한다. */
function UnlinkMenu({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<
    { id: string; label: string }[] | null
  >(null);
  const [isPending, setIsPending] = useState(false);

  const load = async () => {
    const response = await fetch(`/api/tasks/${taskId}/dependencies`);
    if (!response.ok) {
      toast.error("의존 관계를 불러올 수 없습니다.");
      return;
    }
    const json = await response.json();
    setLinks(json.links);
  };

  const remove = async (id: string) => {
    setIsPending(true);
    try {
      const response = await fetch(`/api/dependencies/${id}`, { method: "DELETE" });
      if (!response.ok) {
        toast.error("연결을 해제할 수 없습니다.");
        return;
      }
      toast.success("연결을 해제했습니다.");
      setLinks((prev) => prev?.filter((link) => link.id !== id) ?? null);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <Unlink className="size-4" />
          연결 해제
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>의존 관계 해제</DialogTitle>
          <DialogDescription>
            해제할 연결을 선택하세요. 이미 생성된 회차의 상태는 즉시 재계산됩니다.
          </DialogDescription>
        </DialogHeader>

        {links === null ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : links.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">등록된 연결이 없습니다.</p>
        ) : (
          <ul className="space-y-1.5">
            {links.map((link) => (
              <li
                key={link.id}
                className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-sm"
              >
                <span className="min-w-0">{link.label}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-status-overdue-fg"
                  disabled={isPending}
                  onClick={() => void remove(link.id)}
                >
                  해제
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
