"use client";

/**
 * 배치 수동 실행 — cron 을 기다리지 않고 동작을 확인할 수 있게 한다.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Bell, Loader2, RefreshCw, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";

export function JobRunner() {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const [output, setOutput] = useState<string[]>([]);

  const run = async (job: "generate" | "dispatch" | "both") => {
    setIsRunning(job);
    setOutput([]);
    try {
      const response = await fetch("/api/admin/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job }),
      });
      const json = await response.json();

      if (!response.ok) {
        toast.error(json.error ?? "배치 실행에 실패했습니다.");
        return;
      }

      setOutput(json.messages);
      toast.success("배치를 실행했습니다.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "네트워크 오류가 발생했습니다.",
      );
    } finally {
      setIsRunning(null);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-xs font-medium">수동 실행</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          cron 주기를 기다리지 않고 즉시 실행합니다. 결과는 아래에 표시됩니다.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isRunning !== null}
          onClick={() => void run("generate")}
        >
          {isRunning === "generate" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          회차 생성 배치
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={isRunning !== null}
          onClick={() => void run("dispatch")}
        >
          {isRunning === "dispatch" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Bell className="size-4" />
          )}
          알림 발송 점검
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={isRunning !== null}
          onClick={() => void run("both")}
        >
          {isRunning === "both" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Terminal className="size-4" />
          )}
          둘 다 실행
        </Button>
      </div>

      {output.length > 0 && (
        <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed">
          {output.join("\n")}
        </pre>
      )}
    </div>
  );
}
