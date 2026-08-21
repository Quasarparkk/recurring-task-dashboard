/**
 * 백엔드 스케줄러 (cron)
 * ============================================================================
 *
 * [서버 재시작 후 누락 없는 재개]
 *
 * 이 스케줄러는 "언제 무엇을 보냈는지"를 메모리에 들고 있지 않다.
 * 매 틱마다 DB 를 보고 "보내야 하는데 아직 로그에 없는 알림"을 찾아 보낸다.
 * 따라서 서버가 얼마나 오래 정지했든, 재시작 후 첫 틱에서 놓친 알림이
 * 자동으로 발견된다. 별도의 복구 로직이 없다 — 복구가 정상 동작과 같은 경로다.
 *
 * 부팅 시에는 cron 의 첫 틱을 기다리지 않고 즉시 한 번 실행해
 * 재시작 직후의 공백을 없앤다.
 *
 * 너무 오래 지난 알림(기본 48시간)은 폭주를 막기 위해 발송하지 않고
 * `SKIPPED_STALE` 로 이력만 남긴다 — 왜 오지 않았는지 추적할 수 있어야 하므로.
 */

import { formatInstantKst } from "@/lib/date/kst";
import {
  summarizeSyncResults,
  syncAllOccurrences,
} from "@/lib/services/occurrence-service";
import { dispatchDueNotifications, formatDispatchSummary } from "./dispatcher";

const APP_TIME_ZONE = "Asia/Seoul";

/**
 * 개발 모드의 HMR 로 모듈이 재평가되어도 cron 이 중복 등록되지 않도록
 * globalThis 에 상태를 보관한다.
 */
const globalForScheduler = globalThis as unknown as {
  __jobDashboardScheduler?: {
    started: boolean;
    tasks: { stop: () => void }[];
    /** 동시 실행 방지 플래그 */
    dispatchRunning: boolean;
    generationRunning: boolean;
  };
};

function getState() {
  if (!globalForScheduler.__jobDashboardScheduler) {
    globalForScheduler.__jobDashboardScheduler = {
      started: false,
      tasks: [],
      dispatchRunning: false,
      generationRunning: false,
    };
  }
  return globalForScheduler.__jobDashboardScheduler;
}

function log(message: string): void {
  console.log(`[스케줄러 ${formatInstantKst(new Date())}] ${message}`);
}

// ---------------------------------------------------------------------------
// 작업 정의
// ---------------------------------------------------------------------------

/**
 * 알림 발송 틱.
 * 이전 실행이 끝나지 않았으면 건너뛴다 (긴 SMTP 지연 시 중첩 방지).
 */
export async function runNotificationTick(): Promise<void> {
  const state = getState();
  if (state.dispatchRunning) {
    log("이전 알림 발송이 진행 중이라 이번 틱을 건너뜁니다.");
    return;
  }

  state.dispatchRunning = true;
  try {
    const summary = await dispatchDueNotifications();
    // 보낼 것이 없으면 로그를 남기지 않는다 (매 분 실행되므로 노이즈가 된다).
    if (summary.planned > 0) {
      log(`알림 처리 — ${formatDispatchSummary(summary)}`);
      for (const detail of summary.details) log(`  · ${detail}`);
    }
  } catch (error) {
    console.error("[스케줄러] 알림 발송 중 오류:", error);
  } finally {
    state.dispatchRunning = false;
  }
}

/** Occurrence 롤링 생성 배치. */
export async function runGenerationTick(): Promise<void> {
  const state = getState();
  if (state.generationRunning) {
    log("이전 회차 생성이 진행 중이라 이번 실행을 건너뜁니다.");
    return;
  }

  state.generationRunning = true;
  try {
    const results = await syncAllOccurrences();
    log(`회차 생성 — ${summarizeSyncResults(results)}`);

    for (const result of results) {
      if (result.error) {
        log(`  · [실패] ${result.taskTitle}: ${result.error}`);
      }
    }
  } catch (error) {
    console.error("[스케줄러] 회차 생성 중 오류:", error);
  } finally {
    state.generationRunning = false;
  }
}

// ---------------------------------------------------------------------------
// 시작 / 정지
// ---------------------------------------------------------------------------

export async function startScheduler(): Promise<void> {
  const state = getState();

  if (state.started) return;
  if (process.env.SCHEDULER_ENABLED === "false") {
    log("SCHEDULER_ENABLED=false 이므로 스케줄러를 시작하지 않습니다.");
    return;
  }

  state.started = true;

  const schedulerCron = process.env.SCHEDULER_CRON ?? "* * * * *";
  const generationCron = process.env.GENERATION_CRON ?? "10 4 * * *";

  // node-cron 은 서버 전용 모듈이므로 지연 로드한다.
  const cron = await import("node-cron");

  if (!cron.validate(schedulerCron)) {
    console.error(`[스케줄러] SCHEDULER_CRON 표현식이 올바르지 않습니다: ${schedulerCron}`);
    state.started = false;
    return;
  }
  if (!cron.validate(generationCron)) {
    console.error(`[스케줄러] GENERATION_CRON 표현식이 올바르지 않습니다: ${generationCron}`);
    state.started = false;
    return;
  }

  log(`시작 — 알림 점검 "${schedulerCron}", 회차 생성 "${generationCron}" (${APP_TIME_ZONE})`);

  // --- 부팅 시 즉시 1회 실행 (재시작 공백 제거) --------------------------
  // 회차 생성을 먼저 해야 알림 대상이 존재한다.
  await runGenerationTick();
  await runNotificationTick();

  // --- cron 등록 ---------------------------------------------------------
  const notificationTask = cron.schedule(
    schedulerCron,
    () => {
      void runNotificationTick();
    },
    { timezone: APP_TIME_ZONE },
  );

  const generationTask = cron.schedule(
    generationCron,
    () => {
      void runGenerationTick();
    },
    { timezone: APP_TIME_ZONE },
  );

  state.tasks = [notificationTask, generationTask];
}

export function stopScheduler(): void {
  const state = getState();
  for (const task of state.tasks) {
    try {
      task.stop();
    } catch {
      // 이미 정지된 경우 무시
    }
  }
  state.tasks = [];
  state.started = false;
  log("정지");
}

export function isSchedulerRunning(): boolean {
  return getState().started;
}
