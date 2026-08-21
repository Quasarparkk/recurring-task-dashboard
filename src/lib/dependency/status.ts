/**
 * 발생 건(Occurrence) 상태 계산 — 파생 상태 / blocked 판정 / 지연 영향 분석
 * ============================================================================
 *
 * [핵심 원칙] BLOCKED 와 OVERDUE 는 DB 에 저장하지 않고 여기서 계산한다.
 *   - OVERDUE 는 "오늘"에 따라 달라진다 → 저장하면 날짜가 바뀌는 순간 낡은 값이 된다.
 *   - BLOCKED 는 선행 완료 여부에 따라 달라진다 → 저장하면 연쇄 UPDATE 정합성 문제가 생긴다.
 *
 * 이 모듈은 순수 함수로만 구성되며 Prisma 타입에 의존하지 않는다.
 * 호출자가 필요한 데이터를 평범한 객체로 변환해 주입한다.
 */

import { addByUnit, type HolidayCalendar } from "../date/business-day";
import { diffInDays, maxDate, type PlainDate } from "../date/plain-date";

// ---------------------------------------------------------------------------
// 상태 타입
// ---------------------------------------------------------------------------

/** DB `Occurrence.status` 에 실제로 저장되는 값. */
export type StoredOccurrenceStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "SKIPPED";

/** 화면에 표시되는 상태. 저장 상태 + 파생 상태. */
export type DisplayOccurrenceStatus = StoredOccurrenceStatus | "BLOCKED" | "OVERDUE";

export const STORED_STATUS_LABELS: Record<StoredOccurrenceStatus, string> = {
  PENDING: "예정",
  IN_PROGRESS: "진행중",
  DONE: "완료",
  SKIPPED: "건너뜀",
};

export const DISPLAY_STATUS_LABELS: Record<DisplayOccurrenceStatus, string> = {
  ...STORED_STATUS_LABELS,
  BLOCKED: "대기",
  OVERDUE: "지연",
};

/** 상태별 색상 토큰. 연간 대시보드 셀 색상에 사용. */
export const DISPLAY_STATUS_TONE: Record<
  DisplayOccurrenceStatus,
  "neutral" | "info" | "success" | "warning" | "danger" | "muted"
> = {
  PENDING: "neutral",
  IN_PROGRESS: "info",
  DONE: "success",
  BLOCKED: "warning",
  OVERDUE: "danger",
  SKIPPED: "muted",
};

/** 종료된 상태(더 이상 조치가 필요 없음) */
export function isTerminalStatus(status: StoredOccurrenceStatus): boolean {
  return status === "DONE" || status === "SKIPPED";
}

// ---------------------------------------------------------------------------
// 입력 타입
// ---------------------------------------------------------------------------

export type LagUnit = "BUSINESS_DAY" | "CALENDAR_DAY";

export type MatchStrategy = "SAME_SEQUENCE" | "NEAREST_PRECEDING" | "SAME_PERIOD";

export const MATCH_STRATEGY_LABELS: Record<MatchStrategy, string> = {
  SAME_SEQUENCE: "같은 회차끼리",
  NEAREST_PRECEDING: "가장 가까운 직전 회차",
  SAME_PERIOD: "같은 달의 회차",
};

/** 상태 계산에 필요한 최소한의 Occurrence 정보. */
export interface OccurrenceNode {
  id: string;
  taskId: string;
  sequenceIndex: number;
  scheduledDate: PlainDate;
  status: StoredOccurrenceStatus;
  /** 완료일(달력 날짜). 미완료면 null. */
  completedDate: PlainDate | null;
}

/** Task 레벨 의존 관계. */
export interface TaskDependencyLink {
  id: string;
  predecessorTaskId: string;
  successorTaskId: string;
  lagAmount: number;
  lagUnit: LagUnit;
  matchStrategy: MatchStrategy;
  isBlocking: boolean;
}

/** 회차 레벨 오버라이드. 자동 매칭보다 우선한다. */
export interface OccurrenceOverrideLink {
  id: string;
  predecessorOccurrenceId: string;
  successorOccurrenceId: string;
  lagAmount: number;
  lagUnit: LagUnit;
  isBlocking: boolean;
}

// ---------------------------------------------------------------------------
// 선행 회차 매칭
// ---------------------------------------------------------------------------

export interface ResolvedPredecessor {
  /** 매칭된 선행 회차 */
  occurrence: OccurrenceNode;
  lagAmount: number;
  lagUnit: LagUnit;
  isBlocking: boolean;
  /** 어떤 경로로 매칭되었는지 (디버깅·UI 설명용) */
  source: "OVERRIDE" | MatchStrategy;
  /** Task 레벨 관계에서 왔다면 그 관계 ID */
  linkId: string;
}

/** taskId → 그 Task 의 Occurrence 목록 (마감일 오름차순 정렬 필요) */
export type OccurrencesByTask = Map<string, OccurrenceNode[]>;

export function groupOccurrencesByTask(
  occurrences: readonly OccurrenceNode[],
): OccurrencesByTask {
  const map: OccurrencesByTask = new Map();
  for (const occurrence of occurrences) {
    const list = map.get(occurrence.taskId);
    if (list) list.push(occurrence);
    else map.set(occurrence.taskId, [occurrence]);
  }
  // 매칭 로직이 정렬을 전제하므로 여기서 보장한다.
  for (const list of map.values()) {
    list.sort((a, b) =>
      a.scheduledDate === b.scheduledDate
        ? a.sequenceIndex - b.sequenceIndex
        : a.scheduledDate < b.scheduledDate
          ? -1
          : 1,
    );
  }
  return map;
}

/** `"YYYY-MM"` 추출 (SAME_PERIOD 매칭용) */
function yearMonth(date: PlainDate): string {
  return date.slice(0, 7);
}

/**
 * 후행 회차에 대응하는 선행 회차들을 찾는다.
 *
 * 회차 레벨 오버라이드가 하나라도 있으면 **그것만** 사용한다.
 * (Task 레벨 자동 매칭과 섞으면 사용자가 의도한 예외가 무력화된다)
 */
export function resolvePredecessors(
  successor: OccurrenceNode,
  links: readonly TaskDependencyLink[],
  overrides: readonly OccurrenceOverrideLink[],
  occurrencesByTask: OccurrencesByTask,
  occurrenceById: Map<string, OccurrenceNode>,
): ResolvedPredecessor[] {
  // --- 1) 회차 레벨 오버라이드 우선 ---------------------------------------
  const relevantOverrides = overrides.filter(
    (o) => o.successorOccurrenceId === successor.id,
  );

  if (relevantOverrides.length > 0) {
    const resolved: ResolvedPredecessor[] = [];
    for (const override of relevantOverrides) {
      const predecessor = occurrenceById.get(override.predecessorOccurrenceId);
      if (!predecessor) continue; // 삭제된 회차를 가리키는 경우 무시
      resolved.push({
        occurrence: predecessor,
        lagAmount: override.lagAmount,
        lagUnit: override.lagUnit,
        isBlocking: override.isBlocking,
        source: "OVERRIDE",
        linkId: override.id,
      });
    }
    return resolved;
  }

  // --- 2) Task 레벨 자동 매칭 --------------------------------------------
  const resolved: ResolvedPredecessor[] = [];

  for (const link of links) {
    if (link.successorTaskId !== successor.taskId) continue;

    const candidates = occurrencesByTask.get(link.predecessorTaskId) ?? [];
    if (candidates.length === 0) continue;

    const matched = matchCandidates(successor, candidates, link.matchStrategy);

    for (const predecessor of matched) {
      resolved.push({
        occurrence: predecessor,
        lagAmount: link.lagAmount,
        lagUnit: link.lagUnit,
        isBlocking: link.isBlocking,
        source: link.matchStrategy,
        linkId: link.id,
      });
    }
  }

  return resolved;
}

function matchCandidates(
  successor: OccurrenceNode,
  candidates: readonly OccurrenceNode[],
  strategy: MatchStrategy,
): OccurrenceNode[] {
  switch (strategy) {
    case "SAME_SEQUENCE": {
      const found = candidates.find((c) => c.sequenceIndex === successor.sequenceIndex);
      return found ? [found] : [];
    }

    case "SAME_PERIOD": {
      const target = yearMonth(successor.scheduledDate);
      return candidates.filter((c) => yearMonth(c.scheduledDate) === target);
    }

    case "NEAREST_PRECEDING":
    default: {
      // 후행 마감일 이전(같은 날 포함) 중 가장 늦은 선행 회차.
      // candidates 는 마감일 오름차순이므로 뒤에서부터 찾는다.
      for (let i = candidates.length - 1; i >= 0; i -= 1) {
        if (candidates[i].scheduledDate <= successor.scheduledDate) {
          return [candidates[i]];
        }
      }
      // 선행 회차가 후행보다 모두 나중인 경우 → 매칭 없음(차단하지 않음)
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// 파생 상태 계산
// ---------------------------------------------------------------------------

export interface BlockingPredecessor {
  occurrenceId: string;
  taskId: string;
  scheduledDate: PlainDate;
  status: StoredOccurrenceStatus;
  lagAmount: number;
  lagUnit: LagUnit;
  /** 이 선행이 완료되면 후행을 착수할 수 있게 되는 날짜(예상) */
  projectedReadyDate: PlainDate;
}

export interface DelayImpact {
  /** 선행 사정을 반영한, 후행을 착수할 수 있는 가장 빠른 날짜 */
  earliestStartDate: PlainDate;
  /** 후행 마감일을 초과하는 일수. 0 이하면 여유가 있다. */
  overshootDays: number;
  /** 영향을 유발한 선행 회차 ID */
  causedByOccurrenceId: string;
}

export interface DerivedStatus {
  /** 화면에 표시할 단일 상태 */
  status: DisplayOccurrenceStatus;
  /** 마감일이 지났고 아직 종료되지 않았는지 */
  isOverdue: boolean;
  /** 마감일까지 남은 일수. 음수면 초과. 종료 상태면 null. */
  daysUntilDue: number | null;
  /** 차단 중인 선행 회차 목록 (isBlocking 이고 아직 완료되지 않은 것) */
  blockedBy: BlockingPredecessor[];
  /** 선행 지연이 이 회차 마감일에 미치는 영향. 영향이 없으면 null. */
  delayImpact: DelayImpact | null;
}

export interface ComputeDerivedStatusOptions {
  occurrence: OccurrenceNode;
  predecessors: readonly ResolvedPredecessor[];
  /** 기준일 (보통 서울 기준 오늘) */
  today: PlainDate;
  calendar: HolidayCalendar;
}

/**
 * 발생 건의 표시 상태와 지연 영향을 계산한다.
 *
 * [단일 상태 결정 우선순위]
 *   1. DONE / SKIPPED — 종료된 건은 그대로
 *   2. OVERDUE        — 마감 초과 (가장 시급한 경보)
 *   3. BLOCKED        — 선행 미완료
 *   4. IN_PROGRESS
 *   5. PENDING
 *
 * OVERDUE 를 BLOCKED 보다 앞에 둔 이유: 마감을 넘긴 건은 원인이 무엇이든
 * 즉시 눈에 띄어야 한다. 차단 여부는 `blockedBy` 로 함께 제공되므로
 * 상세 화면에서 "선행 대기 중이라 지연됨"을 함께 표시할 수 있다.
 */
export function computeDerivedStatus(
  options: ComputeDerivedStatusOptions,
): DerivedStatus {
  const { occurrence, predecessors, today, calendar } = options;

  // --- 종료된 건 ---------------------------------------------------------
  if (isTerminalStatus(occurrence.status)) {
    return {
      status: occurrence.status,
      isOverdue: false,
      daysUntilDue: null,
      blockedBy: [],
      delayImpact: null,
    };
  }

  const daysUntilDue = diffInDays(occurrence.scheduledDate, today);
  const isOverdue = daysUntilDue < 0;

  // --- 차단 판정 ---------------------------------------------------------
  const blockedBy: BlockingPredecessor[] = [];
  let worstImpact: DelayImpact | null = null;

  for (const predecessor of predecessors) {
    const predOccurrence = predecessor.occurrence;

    // SKIPPED 된 선행은 차단하지 않는다 (의도적으로 건너뛴 회차이므로).
    if (predOccurrence.status === "SKIPPED") continue;

    const isComplete = predOccurrence.status === "DONE";

    // 선행이 완료될 것으로 기대되는 날짜.
    //   완료됨   → 실제 완료일 (없으면 마감일로 대체)
    //   미완료   → 마감일과 오늘 중 나중 (오늘 기준으로 이미 늦었다면 오늘이 최선)
    const expectedCompletion = isComplete
      ? (predOccurrence.completedDate ?? predOccurrence.scheduledDate)
      : maxDate(predOccurrence.scheduledDate, today);

    const projectedReadyDate = addByUnit(
      expectedCompletion,
      predecessor.lagAmount,
      predecessor.lagUnit,
      calendar,
    );

    if (predecessor.isBlocking && !isComplete) {
      blockedBy.push({
        occurrenceId: predOccurrence.id,
        taskId: predOccurrence.taskId,
        scheduledDate: predOccurrence.scheduledDate,
        status: predOccurrence.status,
        lagAmount: predecessor.lagAmount,
        lagUnit: predecessor.lagUnit,
        projectedReadyDate,
      });
    }

    // --- 지연 영향 -------------------------------------------------------
    // 선행 완료 + lag 가 후행 마감일을 넘기면 경고 대상이다.
    // 완료된 선행도 대상에 포함한다 (이미 늦게 끝나서 후행이 불가능한 경우).
    const overshootDays = diffInDays(projectedReadyDate, occurrence.scheduledDate);
    if (overshootDays > 0) {
      if (!worstImpact || overshootDays > worstImpact.overshootDays) {
        worstImpact = {
          earliestStartDate: projectedReadyDate,
          overshootDays,
          causedByOccurrenceId: predOccurrence.id,
        };
      }
    }
  }

  // --- 단일 상태 결정 ----------------------------------------------------
  let status: DisplayOccurrenceStatus;
  if (isOverdue) {
    status = "OVERDUE";
  } else if (blockedBy.length > 0) {
    status = "BLOCKED";
  } else {
    status = occurrence.status; // PENDING | IN_PROGRESS
  }

  return {
    status,
    isOverdue,
    daysUntilDue,
    blockedBy,
    delayImpact: worstImpact,
  };
}

/**
 * 여러 발생 건의 파생 상태를 한 번에 계산한다.
 * 대시보드/목록 조회에서 사용한다.
 */
export function computeDerivedStatuses(options: {
  occurrences: readonly OccurrenceNode[];
  /** 상태 계산에 필요한 모든 Occurrence (선행 회차 포함). occurrences 의 상위 집합이어야 한다. */
  allOccurrences: readonly OccurrenceNode[];
  links: readonly TaskDependencyLink[];
  overrides: readonly OccurrenceOverrideLink[];
  today: PlainDate;
  calendar: HolidayCalendar;
}): Map<string, DerivedStatus> {
  const { occurrences, allOccurrences, links, overrides, today, calendar } = options;

  const occurrencesByTask = groupOccurrencesByTask(allOccurrences);
  const occurrenceById = new Map(allOccurrences.map((o) => [o.id, o]));

  const result = new Map<string, DerivedStatus>();

  for (const occurrence of occurrences) {
    const predecessors = resolvePredecessors(
      occurrence,
      links,
      overrides,
      occurrencesByTask,
      occurrenceById,
    );
    result.set(
      occurrence.id,
      computeDerivedStatus({ occurrence, predecessors, today, calendar }),
    );
  }

  return result;
}

/**
 * 특정 선행 회차의 완료로 차단이 해제되는 후행 회차들을 찾는다.
 * "선행 업무 완료 시 후행 담당자에게 알림" 기능에서 사용한다.
 *
 * @returns 차단이 완전히 해제된(다른 선행도 모두 완료된) 후행 회차 목록
 */
export function findUnblockedSuccessors(options: {
  completedOccurrence: OccurrenceNode;
  allOccurrences: readonly OccurrenceNode[];
  links: readonly TaskDependencyLink[];
  overrides: readonly OccurrenceOverrideLink[];
  today: PlainDate;
  calendar: HolidayCalendar;
}): OccurrenceNode[] {
  const { completedOccurrence, allOccurrences, links, overrides, today, calendar } =
    options;

  const occurrencesByTask = groupOccurrencesByTask(allOccurrences);
  const occurrenceById = new Map(allOccurrences.map((o) => [o.id, o]));

  // 후보: 이 Task 를 선행으로 갖는 Task 들의 회차 + 오버라이드로 직접 연결된 회차
  const successorTaskIds = new Set(
    links
      .filter((l) => l.predecessorTaskId === completedOccurrence.taskId)
      .map((l) => l.successorTaskId),
  );
  const overrideSuccessorIds = new Set(
    overrides
      .filter((o) => o.predecessorOccurrenceId === completedOccurrence.id)
      .map((o) => o.successorOccurrenceId),
  );

  const candidates = allOccurrences.filter(
    (o) =>
      !isTerminalStatus(o.status) &&
      (successorTaskIds.has(o.taskId) || overrideSuccessorIds.has(o.id)),
  );

  const unblocked: OccurrenceNode[] = [];

  for (const candidate of candidates) {
    const predecessors = resolvePredecessors(
      candidate,
      links,
      overrides,
      occurrencesByTask,
      occurrenceById,
    );

    // 이 회차가 실제로 완료된 선행에 의존하는지 확인
    const dependsOnCompleted = predecessors.some(
      (p) => p.occurrence.id === completedOccurrence.id && p.isBlocking,
    );
    if (!dependsOnCompleted) continue;

    const derived = computeDerivedStatus({
      occurrence: candidate,
      predecessors,
      today,
      calendar,
    });

    // 남은 차단이 없을 때만 "해제됨"으로 본다.
    if (derived.blockedBy.length === 0) unblocked.push(candidate);
  }

  return unblocked;
}
