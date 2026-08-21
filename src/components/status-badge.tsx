import { cn } from "@/lib/utils";
import type { DisplayOccurrenceStatus } from "@/lib/dependency/status";
import {
  PRIORITY_LABEL,
  PRIORITY_STYLE,
  STATUS_LABEL,
  STATUS_ORDER,
  STATUS_STYLE,
} from "@/lib/ui/status-style";
import type { Priority } from "@/lib/validation/task-schema";

export function StatusBadge({
  status,
  className,
  size = "sm",
}: {
  status: DisplayOccurrenceStatus;
  className?: string;
  size?: "xs" | "sm";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border font-medium",
        size === "xs" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-xs",
        STATUS_STYLE[status].badge,
        className,
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", STATUS_STYLE[status].dot)}
        aria-hidden
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityBadge({
  priority,
  className,
}: {
  priority: Priority;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded border px-1.5 py-0 text-[10px] font-medium",
        PRIORITY_STYLE[priority],
        className,
      )}
    >
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

/** 상태 색상 범례 */
export function StatusLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {STATUS_ORDER.map((status) => (
        <span
          key={status}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span
            className={cn("size-2.5 rounded-sm", STATUS_STYLE[status].dot)}
            aria-hidden
          />
          {STATUS_LABEL[status]}
        </span>
      ))}
    </div>
  );
}

/** 카테고리 배지 (색상은 DB 에 저장된 HEX 사용) */
export function CategoryBadge({
  name,
  color,
  className,
}: {
  name: string;
  color?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0 text-[10px] font-medium text-muted-foreground",
        className,
      )}
      style={
        color
          ? { borderColor: `${color}55`, backgroundColor: `${color}12`, color }
          : undefined
      }
    >
      {name}
    </span>
  );
}

export function TagBadge({
  name,
  color,
  className,
}: {
  name: string;
  color?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm px-1.5 py-0 text-[10px] text-muted-foreground",
        className,
      )}
      style={color ? { backgroundColor: `${color}18`, color } : { backgroundColor: "var(--muted)" }}
    >
      #{name}
    </span>
  );
}
