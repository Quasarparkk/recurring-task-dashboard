"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function YearSwitcher({
  year,
  currentYear,
  className,
}: {
  year: number;
  /** 실제 오늘이 속한 연도 ("올해" 버튼 표시용) */
  currentYear: number;
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const goToYear = (nextYear: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", String(nextYear));
    // 월간 뷰에서 연도를 바꿀 때 월 파라미터는 유지한다.
    startTransition(() => {
      router.replace(`?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        onClick={() => goToYear(year - 1)}
        aria-label="이전 연도"
      >
        <ChevronLeft className="size-4" />
      </Button>

      <span
        className={cn(
          "min-w-[5rem] text-center text-lg font-semibold tabular-nums transition-opacity",
          isPending && "opacity-50",
        )}
      >
        {year}년
      </span>

      <Button
        variant="outline"
        size="icon"
        className="size-8"
        onClick={() => goToYear(year + 1)}
        aria-label="다음 연도"
      >
        <ChevronRight className="size-4" />
      </Button>

      {year !== currentYear && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground"
          onClick={() => goToYear(currentYear)}
        >
          올해로
        </Button>
      )}
    </div>
  );
}
