import { describe, expect, it } from "vitest";

import { createHolidayCalendar, EMPTY_HOLIDAY_CALENDAR } from "../date/business-day";
import type { PlainDate } from "../date/plain-date";
import {
  computeDerivedStatus,
  computeDerivedStatuses,
  findUnblockedSuccessors,
  groupOccurrencesByTask,
  resolvePredecessors,
  type OccurrenceNode,
  type OccurrenceOverrideLink,
  type StoredOccurrenceStatus,
  type TaskDependencyLink,
} from "./status";

// ---------------------------------------------------------------------------
// 픽스처 헬퍼
// ---------------------------------------------------------------------------

function occ(
  id: string,
  taskId: string,
  sequenceIndex: number,
  scheduledDate: PlainDate,
  status: StoredOccurrenceStatus = "PENDING",
  completedDate: PlainDate | null = null,
): OccurrenceNode {
  return { id, taskId, sequenceIndex, scheduledDate, status, completedDate };
}

function link(
  id: string,
  predecessorTaskId: string,
  successorTaskId: string,
  overrides: Partial<TaskDependencyLink> = {},
): TaskDependencyLink {
  return {
    id,
    predecessorTaskId,
    successorTaskId,
    lagAmount: 0,
    lagUnit: "BUSINESS_DAY",
    matchStrategy: "NEAREST_PRECEDING",
    isBlocking: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 선행 회차 매칭
// ---------------------------------------------------------------------------

describe("resolvePredecessors — 회차 매칭 전략", () => {
  // 선행 Task(P): 매월 5일, 후행 Task(S): 매월 10일
  const predOccurrences = [
    occ("p0", "P", 0, "2026-01-05"),
    occ("p1", "P", 1, "2026-02-05"),
    occ("p2", "P", 2, "2026-03-05"),
  ];
  const succOccurrences = [
    occ("s0", "S", 0, "2026-01-10"),
    occ("s1", "S", 1, "2026-02-10"),
    occ("s2", "S", 2, "2026-03-10"),
  ];
  const all = [...predOccurrences, ...succOccurrences];
  const byTask = groupOccurrencesByTask(all);
  const byId = new Map(all.map((o) => [o.id, o]));

  it("NEAREST_PRECEDING: 후행 마감일 이전 중 가장 가까운 선행", () => {
    const resolved = resolvePredecessors(
      succOccurrences[1], // 2026-02-10
      [link("l1", "P", "S", { matchStrategy: "NEAREST_PRECEDING" })],
      [],
      byTask,
      byId,
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].occurrence.id).toBe("p1"); // 2026-02-05
    expect(resolved[0].source).toBe("NEAREST_PRECEDING");
  });

  it("NEAREST_PRECEDING: 같은 날짜도 포함한다", () => {
    const samDayPred = occ("px", "P", 0, "2026-01-10");
    const localAll = [samDayPred, succOccurrences[0]];
    const resolved = resolvePredecessors(
      succOccurrences[0], // 2026-01-10
      [link("l1", "P", "S", { matchStrategy: "NEAREST_PRECEDING" })],
      [],
      groupOccurrencesByTask(localAll),
      new Map(localAll.map((o) => [o.id, o])),
    );

    expect(resolved[0].occurrence.id).toBe("px");
  });

  it("NEAREST_PRECEDING: 선행이 모두 나중이면 매칭되지 않는다", () => {
    const laterPred = [occ("p9", "P", 0, "2026-06-05")];
    const localAll = [...laterPred, succOccurrences[0]];
    const resolved = resolvePredecessors(
      succOccurrences[0], // 2026-01-10
      [link("l1", "P", "S")],
      [],
      groupOccurrencesByTask(localAll),
      new Map(localAll.map((o) => [o.id, o])),
    );

    expect(resolved).toHaveLength(0);
  });

  it("SAME_SEQUENCE: 같은 회차 번호끼리 매칭한다", () => {
    const resolved = resolvePredecessors(
      succOccurrences[2], // sequenceIndex 2
      [link("l1", "P", "S", { matchStrategy: "SAME_SEQUENCE" })],
      [],
      byTask,
      byId,
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].occurrence.id).toBe("p2");
    expect(resolved[0].source).toBe("SAME_SEQUENCE");
  });

  it("SAME_SEQUENCE: 해당 번호가 없으면 매칭되지 않는다", () => {
    const resolved = resolvePredecessors(
      occ("s9", "S", 99, "2026-12-10"),
      [link("l1", "P", "S", { matchStrategy: "SAME_SEQUENCE" })],
      [],
      byTask,
      byId,
    );

    expect(resolved).toHaveLength(0);
  });

  it("SAME_PERIOD: 같은 달의 선행 회차를 모두 매칭한다", () => {
    const multiInMonth = [
      occ("pa", "P", 0, "2026-02-05"),
      occ("pb", "P", 1, "2026-02-20"),
      occ("pc", "P", 2, "2026-03-05"),
    ];
    const localAll = [...multiInMonth, succOccurrences[1]];
    const resolved = resolvePredecessors(
      succOccurrences[1], // 2026-02-10
      [link("l1", "P", "S", { matchStrategy: "SAME_PERIOD" })],
      [],
      groupOccurrencesByTask(localAll),
      new Map(localAll.map((o) => [o.id, o])),
    );

    expect(resolved.map((r) => r.occurrence.id).sort()).toEqual(["pa", "pb"]);
  });

  it("선행이 여러 Task 인 경우 모두 매칭한다 (다중 선행)", () => {
    const p2Occurrences = [occ("q0", "Q", 0, "2026-02-01")];
    const localAll = [...predOccurrences, ...p2Occurrences, ...succOccurrences];
    const resolved = resolvePredecessors(
      succOccurrences[1],
      [link("l1", "P", "S"), link("l2", "Q", "S")],
      [],
      groupOccurrencesByTask(localAll),
      new Map(localAll.map((o) => [o.id, o])),
    );

    expect(resolved.map((r) => r.occurrence.taskId).sort()).toEqual(["P", "Q"]);
  });

  it("다른 Task 를 대상으로 하는 관계는 무시한다", () => {
    const resolved = resolvePredecessors(
      succOccurrences[1],
      [link("l1", "P", "OTHER")], // 후행이 S 가 아님
      [],
      byTask,
      byId,
    );

    expect(resolved).toHaveLength(0);
  });

  it("오버라이드가 있으면 Task 레벨 매칭을 완전히 대체한다", () => {
    const override: OccurrenceOverrideLink = {
      id: "o1",
      predecessorOccurrenceId: "p0", // 2026-01-05 (자동 매칭이라면 p1 이 선택됨)
      successorOccurrenceId: "s1",
      lagAmount: 3,
      lagUnit: "CALENDAR_DAY",
      isBlocking: true,
    };

    const resolved = resolvePredecessors(
      succOccurrences[1],
      [link("l1", "P", "S")],
      [override],
      byTask,
      byId,
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].occurrence.id).toBe("p0");
    expect(resolved[0].source).toBe("OVERRIDE");
    expect(resolved[0].lagAmount).toBe(3);
    expect(resolved[0].lagUnit).toBe("CALENDAR_DAY");
  });

  it("삭제된 회차를 가리키는 오버라이드는 무시한다", () => {
    const override: OccurrenceOverrideLink = {
      id: "o1",
      predecessorOccurrenceId: "does-not-exist",
      successorOccurrenceId: "s1",
      lagAmount: 0,
      lagUnit: "BUSINESS_DAY",
      isBlocking: true,
    };

    const resolved = resolvePredecessors(
      succOccurrences[1],
      [link("l1", "P", "S")],
      [override],
      byTask,
      byId,
    );

    expect(resolved).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 파생 상태
// ---------------------------------------------------------------------------

describe("computeDerivedStatus — 기본 상태", () => {
  const today: PlainDate = "2026-03-10";

  it("완료된 건은 DONE 이며 지연 판정하지 않는다", () => {
    const result = computeDerivedStatus({
      occurrence: occ("a", "T", 0, "2026-01-05", "DONE", "2026-01-06"),
      predecessors: [],
      today,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result.status).toBe("DONE");
    expect(result.isOverdue).toBe(false);
    expect(result.daysUntilDue).toBeNull();
  });

  it("건너뛴 건은 SKIPPED", () => {
    const result = computeDerivedStatus({
      occurrence: occ("a", "T", 0, "2026-01-05", "SKIPPED"),
      predecessors: [],
      today,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result.status).toBe("SKIPPED");
  });

  it("마감일이 남았으면 PENDING 이고 남은 일수를 준다", () => {
    const result = computeDerivedStatus({
      occurrence: occ("a", "T", 0, "2026-03-20"),
      predecessors: [],
      today,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result.status).toBe("PENDING");
    expect(result.isOverdue).toBe(false);
    expect(result.daysUntilDue).toBe(10);
  });

  it("마감일이 오늘이면 지연이 아니다", () => {
    const result = computeDerivedStatus({
      occurrence: occ("a", "T", 0, "2026-03-10"),
      predecessors: [],
      today,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result.status).toBe("PENDING");
    expect(result.isOverdue).toBe(false);
    expect(result.daysUntilDue).toBe(0);
  });

  it("마감일이 지났으면 OVERDUE", () => {
    const result = computeDerivedStatus({
      occurrence: occ("a", "T", 0, "2026-03-05"),
      predecessors: [],
      today,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result.status).toBe("OVERDUE");
    expect(result.isOverdue).toBe(true);
    expect(result.daysUntilDue).toBe(-5);
  });

  it("진행중이고 마감일이 남았으면 IN_PROGRESS", () => {
    const result = computeDerivedStatus({
      occurrence: occ("a", "T", 0, "2026-03-20", "IN_PROGRESS"),
      predecessors: [],
      today,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result.status).toBe("IN_PROGRESS");
  });

  it("진행중이어도 마감일이 지나면 OVERDUE 가 우선한다", () => {
    const result = computeDerivedStatus({
      occurrence: occ("a", "T", 0, "2026-03-01", "IN_PROGRESS"),
      predecessors: [],
      today,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result.status).toBe("OVERDUE");
  });
});

describe("computeDerivedStatus — 차단(BLOCKED) 판정", () => {
  const today: PlainDate = "2026-03-10";

  it("선행이 미완료면 BLOCKED", () => {
    const result = computeDerivedStatus({
      occurrence: occ("s", "S", 0, "2026-03-20"),
      predecessors: [
        {
          occurrence: occ("p", "P", 0, "2026-03-15", "PENDING"),
          lagAmount: 0,
          lagUnit: "BUSINESS_DAY",
          isBlocking: true,
          source: "NEAREST_PRECEDING",
          linkId: "l1",
        },
      ],
      today,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.blockedBy).toHaveLength(1);
    expect(result.blockedBy[0].occurrenceId).toBe("p");
  });

  it("선행이 완료되면 차단이 풀린다", () => {
    const result = computeDerivedStatus({
      occurrence: occ("s", "S", 0, "2026-03-20"),
      predecessors: [
        {
          occurrence: occ("p", "P", 0, "2026-03-05", "DONE", "2026-03-05"),
          lagAmount: 0,
          lagUnit: "BUSINESS_DAY",
          isBlocking: true,
          source: "NEAREST_PRECEDING",
          linkId: "l1",
        },
      ],
      today,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result.status).toBe("PENDING");
    expect(result.blockedBy).toHaveLength(0);
  });

  it("여러 선행 중 하나만 미완료여도 BLOCKED", () => {
    const result = computeDerivedStatus({
      occurrence: occ("s", "S", 0, "2026-03-20"),
      predecessors: [
        {
          occurrence: occ("p1", "P1", 0, "2026-03-01", "DONE", "2026-03-01"),
          lagAmount: 0,
          lagUnit: "BUSINESS_DAY",
          isBlocking: true,
          source: "NEAREST_PRECEDING",
          linkId: "l1",
        },
        {
          occurrence: occ("p2", "P2", 0, "2026-03-15", "PENDING"),
          lagAmount: 0,
          lagUnit: "BUSINESS_DAY",
          isBlocking: true,
          source: "NEAREST_PRECEDING",
          linkId: "l2",
        },
      ],
      today,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.blockedBy.map((b) => b.occurrenceId)).toEqual(["p2"]);
  });

  it("isBlocking: false 인 관계는 차단하지 않는다 (참고용 연결)", () => {
    const result = computeDerivedStatus({
      occurrence: occ("s", "S", 0, "2026-03-20"),
      predecessors: [
        {
          occurrence: occ("p", "P", 0, "2026-03-15", "PENDING"),
          lagAmount: 0,
          lagUnit: "BUSINESS_DAY",
          isBlocking: false,
          source: "NEAREST_PRECEDING",
          linkId: "l1",
        },
      ],
      today,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result.status).toBe("PENDING");
    expect(result.blockedBy).toHaveLength(0);
  });

  it("SKIPPED 된 선행은 차단하지 않는다", () => {
    const result = computeDerivedStatus({
      occurrence: occ("s", "S", 0, "2026-03-20"),
      predecessors: [
        {
          occurrence: occ("p", "P", 0, "2026-03-15", "SKIPPED"),
          lagAmount: 0,
          lagUnit: "BUSINESS_DAY",
          isBlocking: true,
          source: "NEAREST_PRECEDING",
          linkId: "l1",
        },
      ],
      today,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result.status).toBe("PENDING");
    expect(result.blockedBy).toHaveLength(0);
  });

  it("차단 상태여도 마감일이 지나면 OVERDUE 로 표시하고 차단 정보는 유지한다", () => {
    const result = computeDerivedStatus({
      occurrence: occ("s", "S", 0, "2026-03-05"), // 이미 지남
      predecessors: [
        {
          occurrence: occ("p", "P", 0, "2026-03-01", "PENDING"),
          lagAmount: 0,
          lagUnit: "BUSINESS_DAY",
          isBlocking: true,
          source: "NEAREST_PRECEDING",
          linkId: "l1",
        },
      ],
      today,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    // 표시는 지연(경보 우선), 원인은 blockedBy 로 확인 가능
    expect(result.status).toBe("OVERDUE");
    expect(result.blockedBy).toHaveLength(1);
  });
});

describe("computeDerivedStatus — 지연 영향(lag) 분석", () => {
  const today: PlainDate = "2026-03-10";

  // 2026-03 픽스처: 3/1(일) 삼일절, 3/2(월) 대체공휴일
  const calendar = createHolidayCalendar([
    { date: "2026-03-01", name: "삼일절" },
    { date: "2026-03-02", name: "대체공휴일" },
  ]);

  it("선행 완료 후 lag 를 더한 착수 가능일을 계산한다", () => {
    const result = computeDerivedStatus({
      occurrence: occ("s", "S", 0, "2026-03-31"),
      predecessors: [
        {
          occurrence: occ("p", "P", 0, "2026-03-20", "PENDING"),
          lagAmount: 3,
          lagUnit: "BUSINESS_DAY",
          isBlocking: true,
          source: "NEAREST_PRECEDING",
          linkId: "l1",
        },
      ],
      today,
      calendar,
    });

    // 3/20(금) + 3영업일 = 3/25(수)
    expect(result.blockedBy[0].projectedReadyDate).toBe("2026-03-25");
    // 후행 마감(3/31)보다 이르므로 지연 영향 없음
    expect(result.delayImpact).toBeNull();
  });

  it("lag 를 더한 결과가 후행 마감을 넘으면 지연 경고를 낸다", () => {
    const result = computeDerivedStatus({
      occurrence: occ("s", "S", 0, "2026-03-24"),
      predecessors: [
        {
          occurrence: occ("p", "P", 0, "2026-03-20", "PENDING"),
          lagAmount: 3,
          lagUnit: "BUSINESS_DAY",
          isBlocking: true,
          source: "NEAREST_PRECEDING",
          linkId: "l1",
        },
      ],
      today,
      calendar,
    });

    // 착수 가능일 3/25 > 마감 3/24 → 1일 초과
    expect(result.delayImpact).not.toBeNull();
    expect(result.delayImpact!.earliestStartDate).toBe("2026-03-25");
    expect(result.delayImpact!.overshootDays).toBe(1);
    expect(result.delayImpact!.causedByOccurrenceId).toBe("p");
  });

  it("선행이 이미 지연 중이면 오늘 기준으로 착수 가능일을 재계산한다", () => {
    const result = computeDerivedStatus({
      occurrence: occ("s", "S", 0, "2026-03-12"),
      predecessors: [
        {
          // 마감일 3/05 인데 오늘은 3/10 → 이미 5일 지연
          occurrence: occ("p", "P", 0, "2026-03-05", "PENDING"),
          lagAmount: 3,
          lagUnit: "BUSINESS_DAY",
          isBlocking: true,
          source: "NEAREST_PRECEDING",
          linkId: "l1",
        },
      ],
      today,
      calendar,
    });

    // 선행 마감(3/5)이 아니라 오늘(3/10)을 기준으로 +3영업일 = 3/13(금)
    expect(result.blockedBy[0].projectedReadyDate).toBe("2026-03-13");
    // 후행 마감 3/12 를 1일 초과
    expect(result.delayImpact!.overshootDays).toBe(1);
  });

  it("완료된 선행의 실제 완료일을 기준으로 계산한다", () => {
    const result = computeDerivedStatus({
      occurrence: occ("s", "S", 0, "2026-03-12"),
      predecessors: [
        {
          // 3/5 마감인데 3/11 에 늦게 완료됨
          occurrence: occ("p", "P", 0, "2026-03-05", "DONE", "2026-03-11"),
          lagAmount: 2,
          lagUnit: "BUSINESS_DAY",
          isBlocking: true,
          source: "NEAREST_PRECEDING",
          linkId: "l1",
        },
      ],
      today,
      calendar,
    });

    // 완료됐으므로 차단은 없지만, 지연 영향은 남는다.
    expect(result.blockedBy).toHaveLength(0);
    // 3/11(수) + 2영업일 = 3/13(금) > 마감 3/12
    expect(result.delayImpact!.earliestStartDate).toBe("2026-03-13");
    expect(result.delayImpact!.overshootDays).toBe(1);
  });

  it("여러 선행 중 가장 심한 영향을 보고한다", () => {
    const result = computeDerivedStatus({
      occurrence: occ("s", "S", 0, "2026-03-20"),
      predecessors: [
        {
          occurrence: occ("p1", "P1", 0, "2026-03-21", "PENDING"),
          lagAmount: 0,
          lagUnit: "CALENDAR_DAY",
          isBlocking: true,
          source: "NEAREST_PRECEDING",
          linkId: "l1",
        },
        {
          occurrence: occ("p2", "P2", 0, "2026-03-28", "PENDING"),
          lagAmount: 0,
          lagUnit: "CALENDAR_DAY",
          isBlocking: true,
          source: "NEAREST_PRECEDING",
          linkId: "l2",
        },
      ],
      today,
      calendar,
    });

    // p2 가 8일 초과로 더 심각
    expect(result.delayImpact!.causedByOccurrenceId).toBe("p2");
    expect(result.delayImpact!.overshootDays).toBe(8);
  });

  it("CALENDAR_DAY lag 는 주말/공휴일을 무시한다", () => {
    const result = computeDerivedStatus({
      occurrence: occ("s", "S", 0, "2026-03-31"),
      predecessors: [
        {
          occurrence: occ("p", "P", 0, "2026-03-20", "PENDING"),
          lagAmount: 3,
          lagUnit: "CALENDAR_DAY",
          isBlocking: true,
          source: "NEAREST_PRECEDING",
          linkId: "l1",
        },
      ],
      today,
      calendar,
    });

    // 3/20 + 3일 = 3/23 (달력일이므로 주말 무시)
    expect(result.blockedBy[0].projectedReadyDate).toBe("2026-03-23");
  });
});

// ---------------------------------------------------------------------------
// 일괄 계산
// ---------------------------------------------------------------------------

describe("computeDerivedStatuses (일괄)", () => {
  it("여러 회차의 상태를 한 번에 계산한다", () => {
    const all = [
      occ("p0", "P", 0, "2026-03-05", "DONE", "2026-03-05"),
      occ("p1", "P", 1, "2026-04-05", "PENDING"),
      occ("s0", "S", 0, "2026-03-10", "PENDING"),
      occ("s1", "S", 1, "2026-04-10", "PENDING"),
    ];

    const result = computeDerivedStatuses({
      occurrences: all.filter((o) => o.taskId === "S"),
      allOccurrences: all,
      links: [link("l1", "P", "S")],
      overrides: [],
      today: "2026-03-08",
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    // s0 의 선행은 p0(완료) → 차단 없음
    expect(result.get("s0")!.status).toBe("PENDING");
    expect(result.get("s0")!.blockedBy).toHaveLength(0);

    // s1 의 선행은 p1(미완료, 2026-04-05) → 차단
    expect(result.get("s1")!.status).toBe("BLOCKED");
    expect(result.get("s1")!.blockedBy[0].occurrenceId).toBe("p1");
  });
});

// ---------------------------------------------------------------------------
// 차단 해제 탐지 (알림용)
// ---------------------------------------------------------------------------

describe("findUnblockedSuccessors", () => {
  it("선행 완료로 차단이 풀린 후행을 찾는다", () => {
    const completed = occ("p0", "P", 0, "2026-03-05", "DONE", "2026-03-05");
    const all = [completed, occ("s0", "S", 0, "2026-03-10", "PENDING")];

    const result = findUnblockedSuccessors({
      completedOccurrence: completed,
      allOccurrences: all,
      links: [link("l1", "P", "S")],
      overrides: [],
      today: "2026-03-05",
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result.map((o) => o.id)).toEqual(["s0"]);
  });

  it("다른 선행이 아직 남아 있으면 해제로 보지 않는다", () => {
    const completed = occ("p0", "P", 0, "2026-03-05", "DONE", "2026-03-05");
    const all = [
      completed,
      occ("q0", "Q", 0, "2026-03-06", "PENDING"), // 아직 미완료
      occ("s0", "S", 0, "2026-03-10", "PENDING"),
    ];

    const result = findUnblockedSuccessors({
      completedOccurrence: completed,
      allOccurrences: all,
      links: [link("l1", "P", "S"), link("l2", "Q", "S")],
      overrides: [],
      today: "2026-03-05",
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result).toHaveLength(0);
  });

  it("이미 완료된 후행은 대상이 아니다", () => {
    const completed = occ("p0", "P", 0, "2026-03-05", "DONE", "2026-03-05");
    const all = [completed, occ("s0", "S", 0, "2026-03-10", "DONE", "2026-03-09")];

    const result = findUnblockedSuccessors({
      completedOccurrence: completed,
      allOccurrences: all,
      links: [link("l1", "P", "S")],
      overrides: [],
      today: "2026-03-05",
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result).toHaveLength(0);
  });

  it("참고용 연결(isBlocking: false)은 알림 대상이 아니다", () => {
    const completed = occ("p0", "P", 0, "2026-03-05", "DONE", "2026-03-05");
    const all = [completed, occ("s0", "S", 0, "2026-03-10", "PENDING")];

    const result = findUnblockedSuccessors({
      completedOccurrence: completed,
      allOccurrences: all,
      links: [link("l1", "P", "S", { isBlocking: false })],
      overrides: [],
      today: "2026-03-05",
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result).toHaveLength(0);
  });

  it("오버라이드로 연결된 후행도 찾는다", () => {
    const completed = occ("p0", "P", 0, "2026-03-05", "DONE", "2026-03-05");
    const all = [completed, occ("s5", "S", 5, "2026-08-10", "PENDING")];

    const result = findUnblockedSuccessors({
      completedOccurrence: completed,
      allOccurrences: all,
      links: [],
      overrides: [
        {
          id: "o1",
          predecessorOccurrenceId: "p0",
          successorOccurrenceId: "s5",
          lagAmount: 0,
          lagUnit: "BUSINESS_DAY",
          isBlocking: true,
        },
      ],
      today: "2026-03-05",
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(result.map((o) => o.id)).toEqual(["s5"]);
  });
});
