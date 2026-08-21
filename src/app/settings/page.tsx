/**
 * 설정 / 운영 상태
 * ============================================================================
 * 스케줄러 상태, 공휴일 데이터 커버리지, 알림 이력, 배치 수동 실행.
 */

import Link from "next/link";
import { AlertTriangle, Bell, CalendarRange, CheckCircle2, Clock } from "lucide-react";

import { JobRunner } from "@/components/job-runner";
import { Separator } from "@/components/ui/separator";
import { currentYearInSeoul, formatInstantKst, todayInSeoul } from "@/lib/date/kst";
import { addMonths } from "@/lib/date/plain-date";
import { prisma } from "@/lib/db";
import { listChannelOptions } from "@/lib/notification/registry";
import { checkHolidayCoverage } from "@/lib/services/holiday-service";
import {
  getRollingWindowMonths,
  getSetting,
  getStaleNotificationHours,
  SETTING_KEYS,
} from "@/lib/services/settings-service";
import { cn } from "@/lib/utils";

const CHANNEL_LABEL: Record<string, string> = {
  WEB_PUSH: "브라우저",
  EMAIL: "이메일",
  SLACK: "Slack",
  TEAMS: "Teams",
};

const LOG_STATUS_LABEL: Record<string, string> = {
  SENT: "발송",
  FAILED: "실패",
  SKIPPED_STALE: "폐기",
};

/**
 * 이 페이지는 DB 상태와 "지금"을 읽는다.
 * Next.js 는 Prisma 호출을 동적 신호로 인식하지 못해 기본적으로 정적 생성해 버리는데,
 * 그러면 빌드 시점의 데이터와 날짜가 영구히 고정된다.
 * (마감 초과 판정은 "오늘"에 의존하므로 특히 치명적이다)
 */
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const today = todayInSeoul();
  const currentYear = currentYearInSeoul();

  const [
    rollingWindowMonths,
    staleHours,
    lastGeneration,
    lastScheduler,
    coverage,
    counts,
    recentLogs,
    logStats,
    holidayYears,
  ] = await Promise.all([
    getRollingWindowMonths(),
    getStaleNotificationHours(),
    getSetting(SETTING_KEYS.lastGenerationRunAt),
    getSetting(SETTING_KEYS.lastSchedulerRunAt),
    checkHolidayCoverage(currentYear + 2),
    Promise.all([
      prisma.task.count(),
      prisma.task.count({ where: { isActive: true } }),
      prisma.occurrence.count(),
      prisma.taskDependency.count(),
      prisma.holiday.count(),
      prisma.user.count(),
    ]),
    prisma.notificationLog.findMany({
      orderBy: { plannedAt: "desc" },
      take: 25,
      select: {
        id: true,
        channel: true,
        kind: true,
        status: true,
        plannedAt: true,
        sentAt: true,
        title: true,
        error: true,
        recipientAddr: true,
        occurrence: { select: { taskId: true, task: { select: { title: true } } } },
      },
    }),
    prisma.notificationLog.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.holiday.groupBy({
      by: ["year"],
      _count: { _all: true },
      orderBy: { year: "asc" },
    }),
  ]);

  const [taskCount, activeTaskCount, occurrenceCount, dependencyCount, holidayCount, userCount] =
    counts;

  const windowEnd = addMonths(today, rollingWindowMonths);
  const schedulerEnabled = process.env.SCHEDULER_ENABLED !== "false";
  const emailTransport = process.env.EMAIL_TRANSPORT ?? "console";

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 px-4 py-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">설정 및 운영 상태</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          스케줄러 동작, 공휴일 데이터, 알림 발송 이력을 확인합니다.
        </p>
      </div>

      {/* ================= 데이터 현황 ================= */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">데이터 현황</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "등록 업무", value: taskCount, hint: `활성 ${activeTaskCount}` },
            { label: "발생 회차", value: occurrenceCount, hint: `${windowEnd} 까지` },
            { label: "의존 관계", value: dependencyCount, hint: "DAG" },
            { label: "공휴일", value: holidayCount, hint: `${holidayYears.length}개 연도` },
            { label: "담당자", value: userCount, hint: "시드 데이터" },
            {
              label: "롤링 윈도우",
              value: rollingWindowMonths,
              hint: "개월",
            },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border bg-card px-3 py-2.5">
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-xl font-semibold tabular-nums">{item.value}</span>
                <span className="text-[11px] text-muted-foreground">{item.hint}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ================= 스케줄러 ================= */}
      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Clock className="size-4 text-muted-foreground" />
          백엔드 스케줄러
        </h2>

        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                schedulerEnabled
                  ? "border-status-done-line/40 bg-status-done-bg text-status-done-fg"
                  : "border-status-skipped-line/40 bg-status-skipped-bg text-status-skipped-fg",
              )}
            >
              {schedulerEnabled ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <AlertTriangle className="size-3.5" />
              )}
              {schedulerEnabled ? "동작 중" : "비활성 (SCHEDULER_ENABLED=false)"}
            </span>
          </div>

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">알림 점검 주기</dt>
              <dd className="font-mono text-xs">
                {process.env.SCHEDULER_CRON ?? "* * * * *"} (Asia/Seoul)
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">회차 생성 배치</dt>
              <dd className="font-mono text-xs">
                {process.env.GENERATION_CRON ?? "10 4 * * *"} (Asia/Seoul)
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">마지막 알림 점검</dt>
              <dd className="tabular-nums">
                {lastScheduler ? formatInstantKst(lastScheduler) : "기록 없음"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">마지막 회차 생성</dt>
              <dd className="tabular-nums">
                {lastGeneration ? formatInstantKst(lastGeneration) : "기록 없음"}
              </dd>
            </div>
          </dl>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">서버 재시작 후 누락 없는 재개</p>
            <p className="mt-1">
              스케줄러는 발송 이력을 메모리에 두지 않습니다. 매 틱마다 DB 를 보고 &ldquo;보내야
              하는데 아직 발송 기록이 없는 알림&rdquo;을 찾아 처리하므로, 서버가 얼마나 오래
              정지했든 재시작 직후 첫 틱에서 놓친 알림이 자동으로 발견됩니다. 부팅 시에도
              cron 을 기다리지 않고 즉시 한 번 실행합니다.
            </p>
            <p className="mt-1.5">
              다만 <strong>{staleHours}시간</strong> 이상 지난 알림은 폭주를 막기 위해
              발송하지 않고 <code className="rounded bg-background px-1">폐기</code> 로 이력만
              남깁니다.
            </p>
          </div>

          <Separator />
          <JobRunner />
        </div>
      </section>

      {/* ================= 알림 채널 ================= */}
      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Bell className="size-4 text-muted-foreground" />
          알림 채널
        </h2>

        <div className="space-y-3 rounded-lg border bg-card p-4">
          <ul className="space-y-2">
            {listChannelOptions().map((channel) => (
              <li key={channel.id} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                  {channel.id}
                </span>
                <span>
                  <span className="font-medium">{channel.label}</span>
                  <span className="ml-1.5 text-muted-foreground">
                    {channel.description}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>
              현재 이메일 전송 방식:{" "}
              <code className="rounded bg-background px-1 font-medium">
                {emailTransport}
              </code>
              {emailTransport === "console" &&
                " — 콘솔에 출력만 합니다. 실제 발송은 .env 의 EMAIL_TRANSPORT 를 smtp 로 바꾸고 SMTP_* 를 설정하세요."}
              {emailTransport === "file" && " — .mail-outbox/ 에 .eml 파일로 저장합니다."}
              {emailTransport === "smtp" && ` — ${process.env.SMTP_HOST} 로 발송합니다.`}
            </p>
            <p className="mt-1.5">
              Slack·Teams 를 추가하려면{" "}
              <code className="rounded bg-background px-1">
                src/lib/notification/adapters/
              </code>{" "}
              에 어댑터 파일을 만들고{" "}
              <code className="rounded bg-background px-1">registry.ts</code> 의 ADAPTERS
              배열에 한 줄 추가하면 됩니다. 스케줄러·API·UI 는 수정하지 않습니다.
            </p>
          </div>

          {/* 발송 통계 */}
          {logStats.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {logStats.map((stat) => (
                <span
                  key={stat.status}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs",
                    stat.status === "SENT" &&
                      "border-status-done-line/40 bg-status-done-bg text-status-done-fg",
                    stat.status === "FAILED" &&
                      "border-status-overdue-line/40 bg-status-overdue-bg text-status-overdue-fg",
                    stat.status === "SKIPPED_STALE" &&
                      "border-status-skipped-line/40 bg-status-skipped-bg text-status-skipped-fg",
                  )}
                >
                  {LOG_STATUS_LABEL[stat.status] ?? stat.status}{" "}
                  <strong className="tabular-nums">{stat._count._all}</strong>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ================= 공휴일 데이터 ================= */}
      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <CalendarRange className="size-4 text-muted-foreground" />
          공휴일 데이터
        </h2>

        <div className="space-y-3 rounded-lg border bg-card p-4">
          {!coverage.ok && (
            <div className="flex items-start gap-2 rounded-md border border-status-blocked-line/50 bg-status-blocked-bg/50 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-blocked-fg" />
              <div>
                <p className="font-medium text-status-blocked-fg">
                  데이터가 없는 연도: {coverage.missingYears.join(", ")}년
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  해당 기간의 영업일 계산이 주말만 반영한 부정확한 값이 됩니다.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {holidayYears.map((row) => (
              <span
                key={row.year}
                className="rounded-md border px-2.5 py-1 text-xs tabular-nums"
              >
                {row.year}년{" "}
                <strong>{row._count._all}</strong>일
              </span>
            ))}
          </div>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>
              공휴일은{" "}
              <code className="rounded bg-background px-1">data/holidays/&lt;연도&gt;.json</code>{" "}
              파일에서 시드합니다. 설날·추석·부처님오신날은 음력 기반이라 계산으로 유도할 수
              없고, 대체공휴일 규칙도 법 개정으로 바뀌기 때문에 데이터로 분리했습니다.
            </p>
            <p className="mt-1.5">
              신규 연도를 추가하려면 JSON 파일을 만들고{" "}
              <code className="rounded bg-background px-1">npm run db:seed</code> 를 실행하세요.
              (날짜 기준 upsert 이므로 기존 데이터는 중복되지 않습니다) 자세한 절차는{" "}
              <code className="rounded bg-background px-1">data/holidays/README.md</code> 참고.
            </p>
          </div>
        </div>
      </section>

      {/* ================= 최근 알림 이력 ================= */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">최근 알림 발송 이력</h2>

        {recentLogs.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            발송 이력이 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">상태</th>
                  <th className="px-3 py-2 text-left font-medium">채널</th>
                  <th className="px-3 py-2 text-left font-medium">종류</th>
                  <th className="px-3 py-2 text-left font-medium">업무</th>
                  <th className="px-3 py-2 text-left font-medium">수신</th>
                  <th className="px-3 py-2 text-left font-medium">발송 예정</th>
                  <th className="px-3 py-2 text-left font-medium">실제 발송</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((log) => (
                  <tr key={log.id} className="border-t">
                    <td className="px-3 py-1.5">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-medium",
                          log.status === "SENT" &&
                            "bg-status-done-bg text-status-done-fg",
                          log.status === "FAILED" &&
                            "bg-status-overdue-bg text-status-overdue-fg",
                          log.status === "SKIPPED_STALE" &&
                            "bg-status-skipped-bg text-status-skipped-fg",
                        )}
                      >
                        {LOG_STATUS_LABEL[log.status] ?? log.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      {CHANNEL_LABEL[log.channel] ?? log.channel}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {log.kind === "SCHEDULED"
                        ? "정기"
                        : log.kind === "OVERDUE_REMINDER"
                          ? "지연"
                          : "선행완료"}
                    </td>
                    <td className="max-w-[16rem] truncate px-3 py-1.5">
                      <Link
                        href={`/tasks/${log.occurrence.taskId}`}
                        className="hover:underline"
                      >
                        {log.occurrence.task.title}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {log.recipientAddr ?? "-"}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                      {formatInstantKst(log.plannedAt)}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                      {log.sentAt ? formatInstantKst(log.sentAt) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
