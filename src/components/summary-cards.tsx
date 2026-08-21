import { AlertTriangle, CheckCircle2, Clock, ListTodo, PlayCircle } from "lucide-react";

import { cn } from "@/lib/utils";

interface SummaryCardsProps {
  summary: {
    total: number;
    done: number;
    overdue: number;
    blocked: number;
    inProgress: number;
    pending: number;
    completionRate: number;
    completionBase: number;
  };
  className?: string;
}

export function SummaryCards({ summary, className }: SummaryCardsProps) {
  const items = [
    {
      label: "전체 회차",
      value: summary.total,
      icon: ListTodo,
      tone: "text-muted-foreground",
      hint: `지난 회차 ${summary.completionBase}건`,
    },
    {
      label: "지연",
      value: summary.overdue,
      icon: AlertTriangle,
      tone: "text-status-overdue-fg",
      hint: summary.overdue > 0 ? "즉시 확인 필요" : "없음",
      emphasize: summary.overdue > 0,
    },
    {
      label: "선행 대기",
      value: summary.blocked,
      icon: Clock,
      tone: "text-status-blocked-fg",
      hint: summary.blocked > 0 ? "선행 업무 미완료" : "없음",
    },
    {
      label: "진행중",
      value: summary.inProgress,
      icon: PlayCircle,
      tone: "text-status-progress-fg",
      hint: `예정 ${summary.pending}건`,
    },
    {
      label: "완료",
      value: summary.done,
      icon: CheckCircle2,
      tone: "text-status-done-fg",
      // 완료율은 지난 회차 기준이므로 분모를 함께 보여줘 오해를 막는다.
      hint: `지난 회차 ${summary.completionRate}%`,
    },
  ];

  return (
    <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5", className)}>
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            "rounded-lg border bg-card px-3 py-2.5",
            item.emphasize && "border-status-overdue-line/50 bg-status-overdue-bg/40",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{item.label}</span>
            <item.icon className={cn("size-3.5", item.tone)} />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className={cn("text-2xl font-semibold tabular-nums", item.tone)}>
              {item.value}
            </span>
            <span className="text-[11px] text-muted-foreground">{item.hint}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
