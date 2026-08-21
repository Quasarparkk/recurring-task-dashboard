/**
 * 시드 데이터
 * ============================================================================
 * 현실적인 사내 정기 업무 20건과 그 의존 관계, 공휴일 데이터를 넣는다.
 *
 * 실행: npm run db:seed
 *
 * [멱등성]
 *   - 공휴일 / 사용자 / 카테고리 / 태그 : 유니크 키 기준 upsert (중복 없음)
 *   - 업무(Task)                        : 자연 키가 없으므로 전량 삭제 후 재생성
 *
 * 마지막에 과거 회차 일부를 완료/진행중/지연 상태로 만들어
 * 대시보드가 실제 사용 중인 것처럼 보이게 한다.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { todayInSeoul } from "../src/lib/date/kst";
import {
  addDays,
  diffInDays,
  getYear,
  toDbDate,
  toPlainDate,
  type PlainDate,
} from "../src/lib/date/plain-date";
import { serializeRecurrenceConfig } from "../src/lib/recurrence/types";
import type { RecurrenceConfigInput } from "../src/lib/recurrence/types";
import { recurrenceConfigSchema } from "../src/lib/recurrence/types";
import { syncOccurrencesForTask } from "../src/lib/services/occurrence-service";

const prisma = new PrismaClient();

const TODAY = todayInSeoul();
const THIS_YEAR = getYear(TODAY);

/** 반복 규칙 기본값을 채워 JSON 문자열로 만든다. */
function recurrence(input: RecurrenceConfigInput): string {
  return serializeRecurrenceConfig(recurrenceConfigSchema.parse(input));
}

// ===========================================================================
// 1. 공휴일
// ===========================================================================

interface HolidayFile {
  _meta?: { year: number; verification?: string };
  holidays: { date: string; name: string; type: string }[];
}

async function seedHolidays(): Promise<void> {
  const dir = path.join(process.cwd(), "data", "holidays");

  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    console.warn("⚠️  data/holidays 디렉토리를 찾을 수 없어 공휴일을 건너뜁니다.");
    return;
  }

  let count = 0;
  const years: number[] = [];

  for (const file of files.sort()) {
    const raw = await readFile(path.join(dir, file), "utf8");
    const parsed = JSON.parse(raw) as HolidayFile;
    const year = parsed._meta?.year ?? Number(file.replace(".json", ""));
    years.push(year);

    for (const holiday of parsed.holidays) {
      await prisma.holiday.upsert({
        where: { date: holiday.date },
        create: {
          date: holiday.date,
          year,
          name: holiday.name,
          type: holiday.type,
          source: `data/holidays/${file}`,
        },
        update: {
          year,
          name: holiday.name,
          type: holiday.type,
          source: `data/holidays/${file}`,
        },
      });
      count += 1;
    }
  }

  console.log(`✅ 공휴일 ${count}건 (${years.join(", ")}년)`);
}

// ===========================================================================
// 2. 사용자
// ===========================================================================

const USERS = [
  { name: "김서연", email: "seoyeon.kim@example.co.kr", department: "경영지원팀" },
  { name: "박준호", email: "junho.park@example.co.kr", department: "재무회계팀" },
  { name: "이지훈", email: "jihoon.lee@example.co.kr", department: "인사팀" },
  { name: "최민아", email: "mina.choi@example.co.kr", department: "IT인프라팀" },
  { name: "정우성", email: "woosung.jung@example.co.kr", department: "IT인프라팀" },
  { name: "한소희", email: "sohee.han@example.co.kr", department: "법무팀" },
  { name: "오태현", email: "taehyun.oh@example.co.kr", department: "총무팀" },
  { name: "윤채원", email: "chaewon.yoon@example.co.kr", department: "재무회계팀" },
] as const;

async function seedUsers(): Promise<Map<string, string>> {
  const byName = new Map<string, string>();

  for (const user of USERS) {
    const row = await prisma.user.upsert({
      where: { email: user.email },
      create: { ...user },
      update: { name: user.name, department: user.department },
      select: { id: true, name: true },
    });
    byName.set(row.name, row.id);
  }

  console.log(`✅ 사용자 ${USERS.length}명`);
  return byName;
}

// ===========================================================================
// 3. 카테고리 / 태그
// ===========================================================================

const CATEGORIES = [
  { name: "결산·세무", color: "#0ea5e9", sortOrder: 1 },
  { name: "인사·급여", color: "#8b5cf6", sortOrder: 2 },
  { name: "IT 인프라", color: "#10b981", sortOrder: 3 },
  { name: "법무·계약", color: "#f59e0b", sortOrder: 4 },
  { name: "총무·안전", color: "#ef4444", sortOrder: 5 },
] as const;

const TAGS = [
  { name: "법정의무", color: "#dc2626" },
  { name: "대외제출", color: "#ea580c" },
  { name: "마감업무", color: "#0284c7" },
  { name: "정기점검", color: "#059669" },
  { name: "갱신", color: "#7c3aed" },
  { name: "감사대응", color: "#be185d" },
] as const;

async function seedTaxonomy(): Promise<{
  categories: Map<string, string>;
  tags: Map<string, string>;
}> {
  const categories = new Map<string, string>();
  for (const category of CATEGORIES) {
    const row = await prisma.category.upsert({
      where: { name: category.name },
      create: { ...category },
      update: { color: category.color, sortOrder: category.sortOrder },
      select: { id: true, name: true },
    });
    categories.set(row.name, row.id);
  }

  const tags = new Map<string, string>();
  for (const tag of TAGS) {
    const row = await prisma.tag.upsert({
      where: { name: tag.name },
      create: { ...tag },
      update: { color: tag.color },
      select: { id: true, name: true },
    });
    tags.set(row.name, row.id);
  }

  console.log(`✅ 카테고리 ${CATEGORIES.length}개 · 태그 ${TAGS.length}개`);
  return { categories, tags };
}

// ===========================================================================
// 4. 업무 정의
// ===========================================================================

interface TaskSeed {
  key: string;
  title: string;
  descriptionMd: string;
  category: string;
  tags: string[];
  assignee: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  estimatedHours?: number;
  recurrenceConfig: string;
  referenceLinks?: { label: string; url: string }[];
  checklist?: { title: string; isRequired?: boolean }[];
  notifications?: {
    offsetDays: number;
    timeOfDay: string;
    offsetUnit?: "CALENDAR_DAY" | "BUSINESS_DAY";
    channels: string[];
    isOverdueReminder?: boolean;
    repeatIntervalHours?: number;
    maxRepeats?: number;
  }[];
}

/** 반복 시작일: 올해 1월 1일 (연간 대시보드에 과거 이력이 보이도록) */
const START = `${THIS_YEAR}-01-01` as PlainDate;

const TASK_SEEDS: TaskSeed[] = [
  // ------------------------------------------------------------------ 결산·세무
  {
    key: "monthly-close",
    title: "월 결산 전표 마감",
    descriptionMd: `## 업무 개요

당월 회계 전표를 마감하고 시산표를 확정한다.

## 절차

1. 미결 전표 조회 (ERP → 회계 → 전표조회 → 상태='미결')
2. 부서별 비용 전표 승인 요청 발송
3. 미승인 전표 담당자 개별 확인
4. 감가상각비 자동 계상 배치 실행
5. 시산표 출력 및 전월 대비 이상 계정 확인
6. 마감 처리 (ERP → 회계 → 기간마감)

## ⚠️ 주의사항

- **마감 후에는 전표 수정이 불가능**하다. 반드시 시산표 검토 후 마감할 것.
- 마감일이 휴일인 경우 **직전 영업일로 앞당겨진다**. 부서 전표 제출 마감은 그보다 2영업일 앞이므로 일정을 역산해 안내할 것.
- 재고자산 평가는 분기말에만 수행한다.

## 담당 부서 연락처

| 구분 | 담당 | 연락처 |
|---|---|---|
| ERP 회계모듈 문의 | IT인프라팀 최민아 | 내선 3401 |
| 전표 승인 권한 | 재무회계팀 박준호 | 내선 2201 |
| 세무 검토 | 외부 세무법인 (김회계사) | 02-555-0000 |`,
    category: "결산·세무",
    tags: ["마감업무", "법정의무"],
    assignee: "박준호",
    priority: "HIGH",
    estimatedHours: 8,
    recurrenceConfig: recurrence({
      rule: { type: "MONTHLY_DAY", day: "LAST" },
      startDate: START,
      holidayPolicy: "PREV_BUSINESS_DAY",
    }),
    referenceLinks: [
      { label: "ERP 회계모듈", url: "https://erp.example.co.kr/accounting" },
      { label: "월 결산 체크리스트 (사내위키)", url: "https://wiki.example.co.kr/finance/monthly-close" },
    ],
    checklist: [
      { title: "미결 전표 전량 처리", isRequired: true },
      { title: "감가상각비 계상 배치 실행", isRequired: true },
      { title: "시산표 전월 대비 검토" },
      { title: "가지급금·가수금 정리" },
      { title: "기간마감 처리", isRequired: true },
    ],
    notifications: [
      { offsetDays: -5, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: -1, timeOfDay: "17:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: 0, timeOfDay: "09:00", channels: ["WEB_PUSH"] },
      {
        offsetDays: 0,
        timeOfDay: "18:00",
        channels: ["EMAIL"],
        isOverdueReminder: true,
        repeatIntervalHours: 24,
        maxRepeats: 5,
      },
    ],
  },
  {
    key: "withholding-tax",
    title: "원천세 신고·납부",
    descriptionMd: `## 업무 개요

전월 지급한 급여·사업소득·기타소득에 대한 원천징수세액을 신고하고 납부한다.

## 절차

1. 전월 급여대장에서 소득세·지방소득세 집계
2. 홈택스 → 신고/납부 → 원천세 신고서 작성
3. 지방소득세는 위택스에서 별도 신고
4. 납부서 출력 후 이체 결재 상신

## ⚠️ 주의사항

- **법정 기한은 다음 달 10일**이며, 기한을 넘기면 가산세(무신고 20%, 납부지연 일 0.022%)가 부과된다.
- 반기납부 승인 사업장이 아니므로 **매월 신고**해야 한다.
- 일용근로소득은 지급명세서를 별도로 제출한다.

## 담당 부서 연락처

- 재무회계팀 윤채원 (내선 2205)
- 관할 세무서 법인납세과: 02-000-0000`,
    category: "결산·세무",
    tags: ["법정의무", "대외제출", "마감업무"],
    assignee: "윤채원",
    priority: "HIGH",
    estimatedHours: 3,
    recurrenceConfig: recurrence({
      rule: { type: "MONTHLY_DAY", day: 10 },
      startDate: START,
      holidayPolicy: "PREV_BUSINESS_DAY",
    }),
    referenceLinks: [
      { label: "홈택스", url: "https://hometax.go.kr" },
      { label: "위택스 (지방소득세)", url: "https://wetax.go.kr" },
    ],
    checklist: [
      { title: "급여대장 원천징수액 집계", isRequired: true },
      { title: "홈택스 원천세 신고서 제출", isRequired: true },
      { title: "위택스 지방소득세 신고", isRequired: true },
      { title: "납부 이체 결재 상신", isRequired: true },
      { title: "신고서 사본 보관" },
    ],
    notifications: [
      { offsetDays: -3, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: -1, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      {
        offsetDays: 0,
        timeOfDay: "14:00",
        channels: ["EMAIL"],
        isOverdueReminder: true,
        repeatIntervalHours: 12,
        maxRepeats: 6,
      },
    ],
  },
  {
    key: "vat-return",
    title: "부가가치세 신고",
    descriptionMd: `## 업무 개요

분기별 부가가치세 예정·확정 신고. 1월(2기 확정), 4월(1기 예정), 7월(1기 확정), 10월(2기 예정).

## 절차

1. 매출·매입 세금계산서 전량 수취 확인 (전자세금계산서 + 종이)
2. 신용카드 매출전표·현금영수증 집계
3. 매입세액 불공제 항목 검토 (접대비, 비영업용 소형승용차 등)
4. 홈택스 신고서 작성 및 제출
5. 납부 또는 환급 신청

## ⚠️ 주의사항

- **세금계산서 누락이 가장 흔한 사고 원인**이다. 신고 5영업일 전에 거래처 미수취 목록을 확인해 독촉할 것.
- 매입세액 불공제 항목을 공제로 신고하면 추후 세무조사 시 가산세가 부과된다.
- 신고기한은 각 월의 25일이며 휴일이면 다음 영업일까지 연장된다(국세기본법 제5조).

## 담당 부서 연락처

- 재무회계팀 박준호 (내선 2201)
- 외부 세무법인 (김회계사): 02-555-0000`,
    category: "결산·세무",
    tags: ["법정의무", "대외제출"],
    assignee: "박준호",
    priority: "HIGH",
    estimatedHours: 12,
    recurrenceConfig: recurrence({
      rule: { type: "SPECIFIC_MONTHS_DAY", months: [1, 4, 7, 10], day: 25 },
      startDate: START,
      // 국세 신고기한은 휴일이면 다음 영업일로 연장된다.
      holidayPolicy: "NEXT_BUSINESS_DAY",
    }),
    referenceLinks: [
      { label: "홈택스 부가세 신고", url: "https://hometax.go.kr" },
      { label: "전자세금계산서 조회", url: "https://esero.go.kr" },
    ],
    checklist: [
      { title: "매출 세금계산서 집계", isRequired: true },
      { title: "매입 세금계산서 수취 확인 (거래처 독촉 포함)", isRequired: true },
      { title: "신용카드·현금영수증 매출 집계", isRequired: true },
      { title: "매입세액 불공제 항목 검토", isRequired: true },
      { title: "세무법인 검토 요청" },
      { title: "홈택스 신고서 제출", isRequired: true },
      { title: "납부/환급 처리", isRequired: true },
    ],
    notifications: [
      { offsetDays: -10, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: -5, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: -1, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
    ],
  },
  {
    key: "quarterly-close",
    title: "분기 결산 보고서 작성",
    descriptionMd: `## 업무 개요

분기 재무제표를 확정하고 결산 보고서를 작성한다.

## 절차

1. 3개월 시산표 통합 및 계정별 조정
2. 재고자산 실사 결과 반영
3. 대손충당금 설정
4. 법인세 중간예납 추정
5. 재무상태표 / 손익계산서 / 현금흐름표 작성
6. 전기 동기 대비 증감 분석 코멘트 작성

## ⚠️ 주의사항

- 이 업무는 **월 결산 전표 마감의 후행 업무**다. 3월(6·9·12월) 마감이 완료되지 않으면 착수할 수 없다.
- 반복 규칙이 "분기 종료 후 10영업일"이므로 **1분기 보고서 마감은 4월 중순**이다.
  연초에는 전년도 4분기 결산이 첫 회차가 된다.

## 담당 부서 연락처

- 재무회계팀 박준호 (내선 2201)`,
    category: "결산·세무",
    tags: ["마감업무", "감사대응"],
    assignee: "박준호",
    priority: "HIGH",
    estimatedHours: 24,
    recurrenceConfig: recurrence({
      rule: {
        type: "QUARTERLY",
        anchor: "END",
        offsetAmount: 10,
        offsetUnit: "BUSINESS_DAY",
      },
      startDate: START,
      holidayPolicy: "PREV_BUSINESS_DAY",
    }),
    checklist: [
      { title: "3개월 시산표 통합", isRequired: true },
      { title: "재고자산 실사 반영" },
      { title: "대손충당금 설정" },
      { title: "재무제표 3종 작성", isRequired: true },
      { title: "전기 대비 증감 분석" },
    ],
    notifications: [
      { offsetDays: -7, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: -2, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
    ],
  },
  {
    key: "quarterly-report",
    title: "분기 경영실적 보고 (경영회의)",
    descriptionMd: `## 업무 개요

확정된 분기 결산 자료를 바탕으로 경영회의 보고 자료를 작성하고 발표한다.

## 절차

1. 분기 결산 보고서 수령
2. 사업부별 실적 대비 목표 달성률 집계
3. 주요 KPI 대시보드 갱신
4. 경영진 보고 슬라이드 작성
5. 경영회의 발표

## ⚠️ 주의사항

- **분기 결산 보고서 확정 후 3영업일 뒤**에 시작하는 것이 원칙이다.
  결산이 지연되면 이 업무도 함께 밀리므로, 대시보드의 지연 경고를 확인할 것.
- 사업부별 실적 자료는 각 부서에서 취합해야 하므로 사전 요청이 필요하다.`,
    category: "결산·세무",
    tags: ["대외제출"],
    assignee: "김서연",
    priority: "MEDIUM",
    estimatedHours: 16,
    recurrenceConfig: recurrence({
      rule: {
        type: "QUARTERLY",
        anchor: "END",
        offsetAmount: 20,
        offsetUnit: "BUSINESS_DAY",
      },
      startDate: START,
      holidayPolicy: "PREV_BUSINESS_DAY",
    }),
    checklist: [
      { title: "분기 결산 보고서 수령", isRequired: true },
      { title: "사업부별 실적 취합", isRequired: true },
      { title: "KPI 대시보드 갱신" },
      { title: "보고 슬라이드 작성", isRequired: true },
      { title: "경영회의 발표", isRequired: true },
    ],
    notifications: [{ offsetDays: -5, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] }],
  },
  {
    key: "corporate-tax",
    title: "법인세 신고·납부",
    descriptionMd: `## 업무 개요

전년도 사업연도에 대한 법인세를 신고하고 납부한다. (12월 결산법인 기준 3월 31일)

## 절차

1. 전년도 재무제표 확정 (외부감사 완료 후)
2. 세무조정 계산서 작성 (외부 세무법인)
3. 소득금액조정합계표 / 자본금과적립금조정명세서 등 부속서류 작성
4. 홈택스 신고 및 납부
5. 지방소득세(법인세분) 위택스 신고

## ⚠️ 주의사항

- **연중 가장 중요한 세무 일정**이다. 기한 후 신고 시 무신고가산세 20%.
- 외부감사 보고서가 3월 중순까지 나오지 않으면 일정이 매우 촉박해진다.
  2월 말까지 감사 진행 상황을 반드시 확인할 것.
- 분납 신청(1개월 내) 가능 여부를 자금팀과 사전 협의.

## 담당 부서 연락처

- 재무회계팀 박준호 (내선 2201)
- 외부 세무법인 (김회계사): 02-555-0000
- 회계감사인 (○○회계법인): 02-777-0000`,
    category: "결산·세무",
    tags: ["법정의무", "대외제출", "감사대응"],
    assignee: "박준호",
    priority: "HIGH",
    estimatedHours: 40,
    recurrenceConfig: recurrence({
      rule: { type: "YEARLY", month: 3, day: 31 },
      startDate: START,
      holidayPolicy: "NEXT_BUSINESS_DAY",
    }),
    checklist: [
      { title: "외부감사 보고서 수령", isRequired: true },
      { title: "세무조정계산서 작성 (세무법인)", isRequired: true },
      { title: "부속서류 검토", isRequired: true },
      { title: "홈택스 신고", isRequired: true },
      { title: "위택스 지방소득세 신고", isRequired: true },
      { title: "납부 완료", isRequired: true },
    ],
    notifications: [
      { offsetDays: -30, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: -14, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: -3, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
    ],
  },

  // ------------------------------------------------------------------ 인사·급여
  {
    key: "payroll-confirm",
    title: "급여대장 확정",
    descriptionMd: `## 업무 개요

당월 급여를 계산하고 급여대장을 확정한다.

## 절차

1. 근태 마감 (전월 21일 ~ 당월 20일)
2. 시간외근무 수당 계산 및 부서장 승인 확인
3. 신규 입사자 / 퇴사자 일할 계산
4. 4대보험료 및 소득세 원천징수액 산정
5. 급여대장 출력 후 인사팀장 결재
6. 확정 후 재무회계팀에 이체 요청

## ⚠️ 주의사항

- **확정 후 수정은 다음 달 정산으로 처리**한다. 반드시 결재 전 검토할 것.
- 퇴사자 4대보험 상실 신고는 별도 업무이며 급여 확정과 동시에 진행해야 한다.
- 육아휴직·병가 등 무급 기간은 근태 시스템에서 자동 반영되지 않는 경우가 있어 수동 확인 필요.

## 담당 부서 연락처

- 인사팀 이지훈 (내선 2301)
- 급여 시스템 문의: IT인프라팀 최민아 (내선 3401)`,
    category: "인사·급여",
    tags: ["마감업무", "법정의무"],
    assignee: "이지훈",
    priority: "HIGH",
    estimatedHours: 6,
    recurrenceConfig: recurrence({
      rule: { type: "MONTHLY_DAY", day: 20 },
      startDate: START,
      holidayPolicy: "PREV_BUSINESS_DAY",
    }),
    checklist: [
      { title: "근태 마감 처리", isRequired: true },
      { title: "시간외수당 부서장 승인 확인", isRequired: true },
      { title: "입·퇴사자 일할 계산", isRequired: true },
      { title: "4대보험·소득세 산정", isRequired: true },
      { title: "급여대장 결재 완료", isRequired: true },
    ],
    notifications: [
      { offsetDays: -3, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: 0, timeOfDay: "09:00", channels: ["WEB_PUSH"] },
    ],
  },
  {
    key: "payroll-transfer",
    title: "급여 이체 실행",
    descriptionMd: `## 업무 개요

확정된 급여대장에 따라 임직원 계좌로 급여를 이체한다.

## 절차

1. 급여대장 확정본 수령 (인사팀)
2. 은행 대량이체 파일(txt) 생성 및 검증
3. 이체 총액과 급여대장 총액 일치 확인
4. 자금 잔액 확인 (부족 시 자금 이동 요청)
5. 인터넷뱅킹 대량이체 등록 및 승인 (2인 결재)
6. 이체 결과 확인 및 실패 건 개별 처리

## ⚠️ 주의사항

- **급여대장 확정이 선행 조건**이다. 확정 전 이체는 절대 금지.
- 급여일이 휴일이면 **직전 영업일로 앞당겨 지급**한다 (근로기준법상 정기지급일 준수).
- 이체 실패 건(계좌 오류 등)은 당일 내 개별 이체로 처리해야 한다.
- 대량이체 한도를 초과하면 분할 이체가 필요하므로 사전에 한도 확인.

## 담당 부서 연락처

- 재무회계팀 윤채원 (내선 2205)
- 주거래은행 담당자: 02-333-0000`,
    category: "인사·급여",
    tags: ["마감업무", "법정의무"],
    assignee: "윤채원",
    priority: "HIGH",
    estimatedHours: 3,
    recurrenceConfig: recurrence({
      rule: { type: "MONTHLY_DAY", day: 25 },
      startDate: START,
      holidayPolicy: "PREV_BUSINESS_DAY",
    }),
    checklist: [
      { title: "급여대장 확정본 수령", isRequired: true },
      { title: "대량이체 파일 생성 및 검증", isRequired: true },
      { title: "총액 일치 확인", isRequired: true },
      { title: "자금 잔액 확인", isRequired: true },
      { title: "이체 승인 (2인 결재)", isRequired: true },
      { title: "실패 건 처리" },
    ],
    notifications: [
      { offsetDays: -2, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: 0, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      {
        offsetDays: 0,
        timeOfDay: "15:00",
        channels: ["EMAIL"],
        isOverdueReminder: true,
        repeatIntervalHours: 6,
        maxRepeats: 4,
      },
    ],
  },
  {
    key: "insurance-report",
    title: "4대보험 취득·상실 신고",
    descriptionMd: `## 업무 개요

전월 입·퇴사자에 대한 국민연금·건강보험·고용보험·산재보험 취득/상실 신고.

## 절차

1. 전월 입사자 / 퇴사자 명단 확정
2. 4대사회보험 정보연계센터에서 통합 신고
3. 건강보험 피부양자 등록 처리
4. 신고 접수증 출력 및 보관

## ⚠️ 주의사항

- **취득 신고 기한은 입사한 달의 다음 달 15일**까지다.
- 상실 신고 지연 시 보험료가 계속 부과되므로 퇴사자 처리를 우선할 것.
- 고용보험 이직확인서는 퇴사자가 실업급여를 신청하면 10일 내 제출 의무가 발생한다.

## 담당 부서 연락처

- 인사팀 이지훈 (내선 2301)
- 국민연금공단 지사: 1355`,
    category: "인사·급여",
    tags: ["법정의무", "대외제출"],
    assignee: "이지훈",
    priority: "MEDIUM",
    estimatedHours: 2,
    recurrenceConfig: recurrence({
      rule: { type: "MONTHLY_DAY", day: 15 },
      startDate: START,
      holidayPolicy: "PREV_BUSINESS_DAY",
    }),
    referenceLinks: [
      { label: "4대사회보험 정보연계센터", url: "https://www.4insure.or.kr" },
    ],
    checklist: [
      { title: "입·퇴사자 명단 확정", isRequired: true },
      { title: "취득 신고", isRequired: true },
      { title: "상실 신고", isRequired: true },
      { title: "피부양자 등록" },
      { title: "접수증 보관" },
    ],
    notifications: [{ offsetDays: -2, timeOfDay: "09:00", channels: ["WEB_PUSH"] }],
  },
  {
    key: "year-end-tax",
    title: "연말정산 자료 취합",
    descriptionMd: `## 업무 개요

임직원 연말정산 신고를 위한 소득·세액공제 증빙자료를 취합하고 검증한다.

## 절차

1. 전 직원에게 연말정산 안내 메일 발송 (제출 기한 명시)
2. 홈택스 간소화자료 일괄제공 서비스 신청 동의 확인
3. 간소화자료 외 증빙(기부금, 월세, 안경 등) 수동 수취
4. 부양가족 공제 요건 검증 (소득 100만원 초과 여부 등)
5. 급여시스템에 공제 항목 입력
6. 정산 결과 개인별 통보 및 2월 급여에 반영

## ⚠️ 주의사항

- **연중 가장 문의가 많은 업무**다. FAQ를 미리 사내 게시판에 올려 문의를 줄일 것.
- 부양가족 공제 오류는 추후 가산세로 이어진다. 특히 **형제자매·연간소득 요건**을 반드시 확인.
- 중도입사자는 전 직장 근로소득원천징수영수증이 필요하다.
- 제출 기한을 놓친 직원은 5월 종합소득세 확정신고로 안내한다.

## 담당 부서 연락처

- 인사팀 이지훈 (내선 2301)
- 재무회계팀 윤채원 (내선 2205)`,
    category: "인사·급여",
    tags: ["법정의무", "마감업무"],
    assignee: "이지훈",
    priority: "HIGH",
    estimatedHours: 40,
    recurrenceConfig: recurrence({
      rule: { type: "YEARLY", month: 1, day: 31 },
      startDate: START,
      holidayPolicy: "PREV_BUSINESS_DAY",
    }),
    referenceLinks: [
      { label: "홈택스 연말정산 간소화", url: "https://hometax.go.kr" },
      { label: "연말정산 FAQ (사내위키)", url: "https://wiki.example.co.kr/hr/year-end-tax" },
    ],
    checklist: [
      { title: "전 직원 안내 메일 발송", isRequired: true },
      { title: "간소화자료 일괄제공 동의 확인", isRequired: true },
      { title: "수동 증빙 수취 및 검증", isRequired: true },
      { title: "부양가족 공제 요건 검증", isRequired: true },
      { title: "급여시스템 입력", isRequired: true },
      { title: "개인별 정산 결과 통보", isRequired: true },
    ],
    notifications: [
      { offsetDays: -30, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: -14, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: -7, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: -1, timeOfDay: "17:00", channels: ["WEB_PUSH", "EMAIL"] },
    ],
  },
  {
    key: "health-checkup",
    title: "임직원 건강검진 안내 및 대상자 관리",
    descriptionMd: `## 업무 개요

산업안전보건법에 따른 일반건강진단 대상자를 파악하고 수검을 안내·관리한다.

## 절차

1. 사무직(2년 1회) / 비사무직(1년 1회) 대상자 산출
2. 검진기관 예약 안내 및 검진표 배포
3. 미수검자 월별 추적 및 독촉
4. 검진 결과 수령 및 유소견자 사후관리

## ⚠️ 주의사항

- **미수검 시 과태료가 사업주에게 부과**된다 (1인당 최대 30만원, 산업안전보건법 제175조).
- 연말에 몰리면 검진기관 예약이 어려우므로 상반기 수검을 적극 권장할 것.
- 검진 결과는 민감정보이므로 개인정보 보호 조치 필수 (별도 잠금 보관).

## 담당 부서 연락처

- 총무팀 오태현 (내선 2701)
- 협력 검진기관 (○○병원 건강검진센터): 02-888-0000`,
    category: "인사·급여",
    tags: ["법정의무", "정기점검"],
    assignee: "오태현",
    priority: "MEDIUM",
    estimatedHours: 8,
    recurrenceConfig: recurrence({
      rule: { type: "MONTHLY_NTH_WEEKDAY", nth: 1, weekday: 1 },
      startDate: START,
      holidayPolicy: "NEXT_BUSINESS_DAY",
    }),
    checklist: [
      { title: "대상자 명단 갱신", isRequired: true },
      { title: "미수검자 독촉 발송", isRequired: true },
      { title: "결과 수령 및 보관" },
    ],
    notifications: [{ offsetDays: -1, timeOfDay: "09:00", channels: ["WEB_PUSH"] }],
  },

  // ------------------------------------------------------------------ IT 인프라
  {
    key: "backup-verify",
    title: "서버 백업 복구 검증",
    descriptionMd: `## 업무 개요

주간 백업이 정상적으로 수행되었는지, 그리고 **실제로 복구가 가능한지** 검증한다.

## 절차

1. 백업 로그 확인 (성공/실패/경고)
2. 백업 용량 추이 확인 (급격한 변화는 이상 신호)
3. **임의의 백업 1건을 테스트 서버에 실제 복구** (핵심)
4. 복구된 DB 무결성 검사 실행
5. 검증 결과 기록

## ⚠️ 주의사항

- **"백업이 돌았다"와 "복구가 된다"는 다른 문제다.** 복구 테스트를 생략하면 정작 필요할 때 실패한다.
- 테스트 복구는 반드시 **격리된 테스트 환경**에서 수행할 것. 운영 DB 덮어쓰기 사고 주의.
- 백업 실패가 2주 연속 발생하면 즉시 팀장에게 에스컬레이션.

## 담당 부서 연락처

- IT인프라팀 정우성 (내선 3405)
- 백업 솔루션 벤더 기술지원: 1588-0000`,
    category: "IT 인프라",
    tags: ["정기점검"],
    assignee: "정우성",
    priority: "HIGH",
    estimatedHours: 2,
    recurrenceConfig: recurrence({
      rule: { type: "WEEKLY", weekdays: [1] },
      startDate: START,
      holidayPolicy: "NEXT_BUSINESS_DAY",
    }),
    checklist: [
      { title: "백업 로그 확인", isRequired: true },
      { title: "백업 용량 추이 확인" },
      { title: "테스트 복구 수행", isRequired: true },
      { title: "DB 무결성 검사", isRequired: true },
      { title: "검증 결과 기록", isRequired: true },
    ],
    notifications: [
      { offsetDays: 0, timeOfDay: "09:00", channels: ["WEB_PUSH"] },
      {
        offsetDays: 0,
        timeOfDay: "18:00",
        channels: ["WEB_PUSH"],
        isOverdueReminder: true,
        repeatIntervalHours: 24,
        maxRepeats: 3,
      },
    ],
  },
  {
    key: "security-patch",
    title: "보안 패치 적용 (정기 점검일)",
    descriptionMd: `## 업무 개요

서버·네트워크 장비의 보안 패치를 검토하고 적용한다. 매월 셋째 주 화요일로 고정.

## 절차

1. 패치 목록 검토 (OS, 미들웨어, DB, 네트워크 장비)
2. CVSS 점수 기준 우선순위 분류 (7.0 이상 우선)
3. 테스트 환경 선적용 및 회귀 테스트
4. 변경관리 승인 요청 (CAB)
5. 운영 반영 (점검 공지 후 야간 작업)
6. 적용 후 서비스 정상성 확인

## ⚠️ 주의사항

- **셋째 주 화요일로 고정한 이유**: Microsoft Patch Tuesday(매월 둘째 주 화요일) 직후여서 패치 정보가 안정화된 시점이다.
- 커널 패치는 재부팅이 필요하므로 반드시 사전 공지(최소 3영업일) 후 야간에 진행.
- 롤백 계획 없이 운영 반영 금지.

## 담당 부서 연락처

- IT인프라팀 최민아 (내선 3401)
- 보안관제 업체: 02-999-0000`,
    category: "IT 인프라",
    tags: ["정기점검", "감사대응"],
    assignee: "최민아",
    priority: "HIGH",
    estimatedHours: 6,
    recurrenceConfig: recurrence({
      rule: { type: "MONTHLY_NTH_WEEKDAY", nth: 3, weekday: 2 },
      startDate: START,
      holidayPolicy: "NEXT_BUSINESS_DAY",
    }),
    checklist: [
      { title: "패치 목록 검토", isRequired: true },
      { title: "CVSS 우선순위 분류", isRequired: true },
      { title: "테스트 환경 선적용", isRequired: true },
      { title: "변경관리 승인(CAB)", isRequired: true },
      { title: "점검 공지 발송", isRequired: true },
      { title: "운영 반영 및 정상성 확인", isRequired: true },
    ],
    notifications: [
      { offsetDays: -5, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: -1, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
    ],
  },
  {
    key: "ssl-check",
    title: "SSL 인증서 만료 점검",
    descriptionMd: `## 업무 개요

전사 도메인의 SSL/TLS 인증서 만료일을 점검하고 갱신을 준비한다.

## 절차

1. 인증서 인벤토리 조회 (모니터링 대시보드)
2. 만료 60일 이내 인증서 목록 추출
3. 갱신 대상별 담당자 지정 및 갱신 요청
4. 갱신 완료 건 배포 확인 (모든 로드밸런서·WAF 포함)

## ⚠️ 주의사항

- **인증서 만료는 즉각적인 서비스 장애**로 이어진다. 만료 30일 전에는 반드시 갱신 완료.
- 로드밸런서에만 배포하고 원본 서버를 놓치는 사고가 흔하다. 배포 대상 목록을 체크리스트로 관리할 것.
- 와일드카드 인증서는 갱신 시 영향 범위가 넓으므로 사전 공지 필수.

## 담당 부서 연락처

- IT인프라팀 정우성 (내선 3405)`,
    category: "IT 인프라",
    tags: ["갱신", "정기점검"],
    assignee: "정우성",
    priority: "HIGH",
    estimatedHours: 2,
    recurrenceConfig: recurrence({
      rule: { type: "MONTHLY_NTH_WEEKDAY", nth: 1, weekday: 1 },
      startDate: START,
      holidayPolicy: "NEXT_BUSINESS_DAY",
    }),
    checklist: [
      { title: "인증서 인벤토리 조회", isRequired: true },
      { title: "만료 60일 이내 목록 추출", isRequired: true },
      { title: "갱신 요청 발송" },
      { title: "배포 대상 전수 확인" },
    ],
    notifications: [{ offsetDays: 0, timeOfDay: "10:00", channels: ["WEB_PUSH"] }],
  },
  {
    key: "license-renewal",
    title: "소프트웨어 라이선스 갱신 점검",
    descriptionMd: `## 업무 개요

전사 소프트웨어 라이선스의 만료일과 사용량을 점검하고 갱신·정리한다.

## 절차

1. 라이선스 인벤토리 갱신 (SAM 도구 리포트)
2. 만료 90일 이내 계약 목록 추출
3. 실사용량 대비 보유 수량 검토 (과다 보유 정리, 부족 시 증설)
4. 갱신 견적 요청 및 구매 요청서 상신
5. 미사용 라이선스 회수

## ⚠️ 주의사항

- **라이선스 미준수는 감사 지적 및 벤더 클레임 대상**이다.
- 갱신 협상은 만료 60일 전에 시작해야 가격 협상 여지가 있다.
- 퇴사자 계정에 할당된 라이선스가 회수되지 않는 경우가 많다. 인사 퇴사 데이터와 대조할 것.

## 담당 부서 연락처

- IT인프라팀 최민아 (내선 3401)
- 구매 담당: 총무팀 오태현 (내선 2701)`,
    category: "IT 인프라",
    tags: ["갱신", "감사대응"],
    assignee: "최민아",
    priority: "MEDIUM",
    estimatedHours: 8,
    recurrenceConfig: recurrence({
      rule: { type: "SPECIFIC_MONTHS_DAY", months: [3, 6, 9, 12], day: 15 },
      startDate: START,
      holidayPolicy: "PREV_BUSINESS_DAY",
    }),
    checklist: [
      { title: "라이선스 인벤토리 갱신", isRequired: true },
      { title: "만료 90일 이내 목록 추출", isRequired: true },
      { title: "실사용량 대비 검토", isRequired: true },
      { title: "갱신 견적 요청" },
      { title: "미사용 라이선스 회수" },
    ],
    notifications: [
      { offsetDays: -7, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
    ],
  },
  {
    key: "access-log-audit",
    title: "개인정보 접속기록 점검",
    descriptionMd: `## 업무 개요

개인정보 처리시스템의 접속기록을 점검하고 이상 접근을 확인한다.

## 절차

1. 개인정보처리시스템 접속기록 추출 (당월)
2. 비정상 패턴 확인 (야간 접속, 대량 조회, 권한 외 접근)
3. 이상 건에 대해 담당자 소명 요청
4. 점검 결과서 작성 및 보관

## ⚠️ 주의사항

- **개인정보보호법상 월 1회 이상 점검 의무**이며, 접속기록은 최소 1년(5만명 이상은 2년) 보관해야 한다.
- 점검 결과서는 개인정보 감사 시 필수 제출 자료다. 반드시 서면(전자문서) 보관.
- 접속기록 자체를 임의로 삭제·변경하면 법 위반이다.

## 담당 부서 연락처

- IT인프라팀 최민아 (내선 3401)
- 개인정보보호책임자: 법무팀 한소희 (내선 2601)`,
    category: "IT 인프라",
    tags: ["법정의무", "정기점검", "감사대응"],
    assignee: "최민아",
    priority: "HIGH",
    estimatedHours: 3,
    recurrenceConfig: recurrence({
      rule: { type: "MONTHLY_DAY", day: "LAST" },
      startDate: START,
      holidayPolicy: "PREV_BUSINESS_DAY",
    }),
    checklist: [
      { title: "접속기록 추출", isRequired: true },
      { title: "비정상 패턴 확인", isRequired: true },
      { title: "이상 건 소명 요청" },
      { title: "점검 결과서 작성 및 보관", isRequired: true },
    ],
    notifications: [{ offsetDays: -3, timeOfDay: "09:00", channels: ["WEB_PUSH"] }],
  },

  // ------------------------------------------------------------------ 법무·계약
  {
    key: "contract-review",
    title: "계약서 만료 예정 검토",
    descriptionMd: `## 업무 개요

만료 예정 계약을 검토해 갱신·재협상·종료를 결정한다.

## 절차

1. 계약 관리대장에서 만료 90일 이내 계약 추출
2. 소관 부서에 갱신 의향 확인
3. 갱신 대상 계약 조건 재검토 (단가, 손해배상, 개인정보 처리 조항)
4. 갱신 계약서 작성 및 법무 검토
5. 결재 및 계약 체결

## ⚠️ 주의사항

- **자동갱신 조항이 있는 계약은 해지 통보 기한을 놓치면 1년이 자동 연장**된다. 통보 기한을 우선 확인할 것.
- 개인정보 처리 위탁 계약은 개정 법령 반영 여부를 반드시 검토.
- 하도급 계약은 하도급법상 필수 기재사항 누락 여부 확인.

## 담당 부서 연락처

- 법무팀 한소희 (내선 2601)`,
    category: "법무·계약",
    tags: ["갱신", "감사대응"],
    assignee: "한소희",
    priority: "MEDIUM",
    estimatedHours: 6,
    recurrenceConfig: recurrence({
      rule: { type: "MONTHLY_NTH_WEEKDAY", nth: 2, weekday: 4 },
      startDate: START,
      holidayPolicy: "NEXT_BUSINESS_DAY",
    }),
    checklist: [
      { title: "만료 90일 이내 계약 추출", isRequired: true },
      { title: "자동갱신 해지통보 기한 확인", isRequired: true },
      { title: "소관 부서 갱신 의향 확인", isRequired: true },
      { title: "계약 조건 재검토" },
    ],
    notifications: [{ offsetDays: -2, timeOfDay: "09:00", channels: ["WEB_PUSH"] }],
  },
  {
    key: "corporate-registry",
    title: "법인등기 및 사업자등록 사항 점검",
    descriptionMd: `## 업무 개요

법인등기부와 사업자등록증의 기재사항이 현행과 일치하는지 점검한다.

## 절차

1. 법인등기부등본 발급 (인터넷등기소)
2. 임원 임기 만료 여부 확인
3. 본점·지점 주소, 사업 목적, 자본금 변동사항 확인
4. 사업자등록증 기재사항 대조
5. 변경 필요 시 등기 변경 및 세무서 신고

## ⚠️ 주의사항

- **임원 임기 만료 후 중임 등기를 하지 않으면 과태료**가 부과된다. 임기 만료 2개월 전 확인 필요.
- 등기 변경 사유 발생 후 **2주 내 등기 신청** 의무 (상법 제317조).
- 사업 목적 추가는 정관 변경(주주총회 특별결의)이 선행되어야 한다.

## 담당 부서 연락처

- 법무팀 한소희 (내선 2601)
- 자문 법무법인: 02-444-0000`,
    category: "법무·계약",
    tags: ["법정의무", "정기점검"],
    assignee: "한소희",
    priority: "MEDIUM",
    estimatedHours: 4,
    recurrenceConfig: recurrence({
      rule: { type: "SPECIFIC_MONTHS_DAY", months: [6, 12], day: 1 },
      startDate: START,
      holidayPolicy: "NEXT_BUSINESS_DAY",
    }),
    checklist: [
      { title: "법인등기부등본 발급", isRequired: true },
      { title: "임원 임기 만료 확인", isRequired: true },
      { title: "기재사항 대조", isRequired: true },
      { title: "변경 필요 사항 처리" },
    ],
    notifications: [{ offsetDays: -7, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] }],
  },

  // ------------------------------------------------------------------ 총무·안전
  {
    key: "fire-safety",
    title: "소방시설 자체점검",
    descriptionMd: `## 업무 개요

소방시설법에 따른 자체점검(작동기능점검/종합정밀점검)을 실시하고 결과를 보고한다.

## 절차

1. 점검 업체 일정 협의
2. 입주사·직원 사전 공지 (경보 작동 안내)
3. 점검 실시 입회
4. 불량 항목 조치 계획 수립 및 시정
5. 점검 결과 보고서 관할 소방서 제출

## ⚠️ 주의사항

- **점검 결과 미보고 시 과태료** (소방시설 설치 및 관리에 관한 법률).
- 점검 중 경보가 울리므로 사전 공지 없이 진행하면 대피 혼란이 발생한다.
- 불량 항목은 조치 완료까지 추적해야 한다. 점검만 하고 방치하면 화재 시 책임 문제.

## 담당 부서 연락처

- 총무팀 오태현 (내선 2701)
- 소방점검 업체: 02-222-0000
- 관할 소방서 예방과: 02-111-0000`,
    category: "총무·안전",
    tags: ["법정의무", "정기점검", "대외제출"],
    assignee: "오태현",
    priority: "HIGH",
    estimatedHours: 8,
    recurrenceConfig: recurrence({
      rule: { type: "SPECIFIC_MONTHS_DAY", months: [6, 12], day: 15 },
      startDate: START,
      holidayPolicy: "NEXT_BUSINESS_DAY",
    }),
    checklist: [
      { title: "점검 업체 일정 협의", isRequired: true },
      { title: "사전 공지 발송", isRequired: true },
      { title: "점검 입회", isRequired: true },
      { title: "불량 항목 조치", isRequired: true },
      { title: "결과 보고서 제출", isRequired: true },
    ],
    notifications: [
      { offsetDays: -14, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: -3, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
    ],
  },
  {
    key: "security-training",
    title: "정보보호·개인정보보호 교육 이수 관리",
    descriptionMd: `## 업무 개요

전 임직원의 연간 정보보호 및 개인정보보호 교육 이수를 관리한다.

## 절차

1. 교육 콘텐츠 갱신 (최신 법령·사고 사례 반영)
2. 대상자 명단 확정 (신규 입사자 포함)
3. 교육 시행 및 이수 현황 모니터링
4. 미이수자 독촉 (부서장 통보 포함)
5. 이수 결과 집계 및 증빙 보관

## ⚠️ 주의사항

- **개인정보취급자 교육은 연 1회 이상 법정 의무**다 (개인정보보호법 제28조).
- 이수 증빙(수강 이력, 서명부)은 감사 시 필수 자료이므로 반드시 보관.
- 12월에 몰리면 이수율이 떨어진다. 11월 말 목표로 관리할 것.

## 담당 부서 연락처

- 법무팀 한소희 (내선 2601) — 개인정보보호책임자
- IT인프라팀 최민아 (내선 3401) — 정보보호 담당`,
    category: "총무·안전",
    tags: ["법정의무", "감사대응"],
    assignee: "한소희",
    priority: "MEDIUM",
    estimatedHours: 12,
    recurrenceConfig: recurrence({
      rule: { type: "YEARLY", month: 11, day: 30 },
      startDate: START,
      holidayPolicy: "PREV_BUSINESS_DAY",
    }),
    checklist: [
      { title: "교육 콘텐츠 갱신", isRequired: true },
      { title: "대상자 명단 확정", isRequired: true },
      { title: "교육 시행", isRequired: true },
      { title: "미이수자 독촉" },
      { title: "이수 증빙 보관", isRequired: true },
    ],
    notifications: [
      { offsetDays: -60, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: -14, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
    ],
  },
  {
    key: "inventory-count",
    title: "재고 실사",
    descriptionMd: `## 업무 개요

반기별 재고자산 실사를 통해 장부 수량과 실물을 대조한다.

## 절차

1. 실사 계획 수립 및 실사표 준비
2. 실사 기준일 재고 이동 동결 공지
3. 창고별 실사 실시 (2인 1조, 교차 확인)
4. 장부 대비 차이 원인 분석
5. 재고조정 전표 기표 및 승인

## ⚠️ 주의사항

- **실사 기준일에는 입출고를 반드시 동결**해야 한다. 동결 없이 실사하면 차이 원인을 추적할 수 없다.
- 6월 말·12월 말 실사 결과는 각각 반기·연간 결산에 직접 반영되므로 일정 지연이 결산 지연으로 이어진다.
- 장기 미사용 재고는 평가손 검토 대상으로 별도 표시할 것.

## 담당 부서 연락처

- 총무팀 오태현 (내선 2701)
- 재무회계팀 윤채원 (내선 2205)`,
    category: "총무·안전",
    tags: ["마감업무", "감사대응"],
    assignee: "오태현",
    priority: "MEDIUM",
    estimatedHours: 16,
    recurrenceConfig: recurrence({
      rule: { type: "SPECIFIC_MONTHS_DAY", months: [6, 12], day: "LAST" },
      startDate: START,
      holidayPolicy: "PREV_BUSINESS_DAY",
    }),
    checklist: [
      { title: "실사 계획 및 실사표 준비", isRequired: true },
      { title: "재고 이동 동결 공지", isRequired: true },
      { title: "창고별 실사 실시", isRequired: true },
      { title: "차이 원인 분석", isRequired: true },
      { title: "재고조정 전표 기표", isRequired: true },
    ],
    notifications: [
      { offsetDays: -10, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] },
      { offsetDays: -2, timeOfDay: "09:00", channels: ["WEB_PUSH"] },
    ],
  },
  {
    key: "office-supplies",
    title: "사무용품·소모품 재고 확인 및 발주",
    descriptionMd: `## 업무 개요

사무용품 재고를 확인하고 부족분을 발주한다.

## 절차

1. 비품 창고 재고 실사
2. 부서별 요청 사항 취합
3. 발주 목록 작성 및 단가 확인
4. 구매 요청서 상신 및 발주

## 참고

- 정기 발주 주기: 격주 수요일
- 긴급 소요는 별도 요청 처리`,
    category: "총무·안전",
    tags: ["정기점검"],
    assignee: "오태현",
    priority: "LOW",
    estimatedHours: 2,
    recurrenceConfig: recurrence({
      rule: { type: "WEEKLY", weekdays: [3], intervalWeeks: 2 },
      startDate: START,
      holidayPolicy: "NEXT_BUSINESS_DAY",
    }),
    checklist: [
      { title: "재고 실사" },
      { title: "부서 요청 취합" },
      { title: "발주 처리" },
    ],
  },
  {
    key: "disaster-drill",
    title: "재난 대응 모의훈련",
    descriptionMd: `## 업무 개요

화재·지진 등 재난 상황에 대한 대피 모의훈련을 실시한다. (연 2회)

## 절차

1. 훈련 시나리오 수립
2. 대피 경로 및 집결지 점검
3. 사전 공지 및 층별 안전요원 교육
4. 훈련 실시 (대피 시간 측정)
5. 결과 평가 및 개선사항 도출

## ⚠️ 주의사항

- **소방계획서상 연 1회 이상 훈련 의무**. 실적 없으면 과태료 대상.
- 훈련 중 실제 부상 위험이 있으므로 계단 이용 시 안전요원 배치 필수.
- 장애인·임산부 등 대피 지원 대상자 명단을 사전에 확보할 것.

## 담당 부서 연락처

- 총무팀 오태현 (내선 2701)`,
    category: "총무·안전",
    tags: ["법정의무", "정기점검"],
    assignee: "오태현",
    priority: "MEDIUM",
    estimatedHours: 6,
    recurrenceConfig: recurrence({
      rule: { type: "SPECIFIC_MONTHS_NTH_WEEKDAY", months: [5, 11], nth: 2, weekday: 4 },
      startDate: START,
      holidayPolicy: "NEXT_BUSINESS_DAY",
    }),
    checklist: [
      { title: "훈련 시나리오 수립", isRequired: true },
      { title: "대피 경로 점검", isRequired: true },
      { title: "사전 공지 및 안전요원 교육", isRequired: true },
      { title: "훈련 실시", isRequired: true },
      { title: "결과 평가서 작성", isRequired: true },
    ],
    notifications: [{ offsetDays: -14, timeOfDay: "09:00", channels: ["WEB_PUSH", "EMAIL"] }],
  },
];

// ===========================================================================
// 5. 의존 관계
// ===========================================================================

interface DependencySeed {
  predecessor: string;
  successor: string;
  lagAmount: number;
  lagUnit: "BUSINESS_DAY" | "CALENDAR_DAY";
  matchStrategy: "SAME_SEQUENCE" | "NEAREST_PRECEDING" | "SAME_PERIOD";
  isBlocking: boolean;
  note: string;
}

const DEPENDENCY_SEEDS: DependencySeed[] = [
  {
    predecessor: "payroll-confirm",
    successor: "payroll-transfer",
    lagAmount: 0,
    lagUnit: "BUSINESS_DAY",
    matchStrategy: "SAME_PERIOD",
    isBlocking: true,
    note: "급여대장이 확정되지 않으면 이체할 수 없다. 같은 달 회차끼리 연결.",
  },
  {
    predecessor: "payroll-confirm",
    successor: "insurance-report",
    lagAmount: 0,
    lagUnit: "BUSINESS_DAY",
    matchStrategy: "NEAREST_PRECEDING",
    isBlocking: true,
    note: "급여 확정 시 확정된 입·퇴사자 명단으로 신고한다.",
  },
  {
    predecessor: "payroll-transfer",
    successor: "withholding-tax",
    lagAmount: 0,
    lagUnit: "BUSINESS_DAY",
    matchStrategy: "NEAREST_PRECEDING",
    isBlocking: true,
    note: "급여 지급이 완료되어야 원천징수세액이 확정된다.",
  },
  {
    predecessor: "monthly-close",
    successor: "quarterly-close",
    lagAmount: 2,
    lagUnit: "BUSINESS_DAY",
    matchStrategy: "NEAREST_PRECEDING",
    isBlocking: true,
    note: "분기 마지막 달의 전표 마감 후 2영업일 뒤 분기 결산 착수.",
  },
  {
    predecessor: "quarterly-close",
    successor: "quarterly-report",
    lagAmount: 3,
    lagUnit: "BUSINESS_DAY",
    matchStrategy: "NEAREST_PRECEDING",
    isBlocking: true,
    note: "결산 확정 후 3영업일 뒤 경영보고 자료 작성 착수.",
  },
  {
    predecessor: "inventory-count",
    successor: "quarterly-close",
    lagAmount: 1,
    lagUnit: "BUSINESS_DAY",
    matchStrategy: "NEAREST_PRECEDING",
    isBlocking: false,
    note: "반기 실사 결과가 결산에 반영되지만, 실사가 없는 분기도 있으므로 차단하지 않는다.",
  },
  {
    predecessor: "monthly-close",
    successor: "corporate-tax",
    lagAmount: 0,
    lagUnit: "BUSINESS_DAY",
    matchStrategy: "NEAREST_PRECEDING",
    isBlocking: false,
    note: "참고용 연결. 법인세 신고는 외부감사 완료 여부가 실질적 선행 조건이다.",
  },
  {
    predecessor: "year-end-tax",
    successor: "withholding-tax",
    lagAmount: 0,
    lagUnit: "BUSINESS_DAY",
    matchStrategy: "NEAREST_PRECEDING",
    isBlocking: false,
    note: "연말정산 결과가 2월 급여에 반영되어 원천세 신고액에 영향을 준다.",
  },
];

// ===========================================================================
// 6. 실행
// ===========================================================================

async function seedTasks(
  users: Map<string, string>,
  categories: Map<string, string>,
  tags: Map<string, string>,
): Promise<Map<string, string>> {
  // Task 는 자연 키가 없으므로 전량 삭제 후 재생성한다.
  // (Occurrence, 링크, 체크리스트, 알림 규칙은 Cascade 로 함께 삭제됨)
  const deleted = await prisma.task.deleteMany({});
  if (deleted.count > 0) {
    console.log(`   기존 업무 ${deleted.count}건 삭제 후 재생성`);
  }

  const keyToId = new Map<string, string>();

  for (const seed of TASK_SEEDS) {
    const task = await prisma.task.create({
      data: {
        title: seed.title,
        descriptionMd: seed.descriptionMd,
        categoryId: categories.get(seed.category) ?? null,
        defaultAssigneeId: users.get(seed.assignee) ?? null,
        priority: seed.priority,
        estimatedHours: seed.estimatedHours ?? null,
        recurrenceConfig: seed.recurrenceConfig,
        tags: {
          connect: seed.tags
            .map((name) => tags.get(name))
            .filter((id): id is string => Boolean(id))
            .map((id) => ({ id })),
        },
        referenceLinks: {
          create: (seed.referenceLinks ?? []).map((link, index) => ({
            label: link.label,
            url: link.url,
            sortOrder: index,
          })),
        },
        checklistTemplate: {
          create: (seed.checklist ?? []).map((item, index) => ({
            title: item.title,
            isRequired: item.isRequired ?? false,
            sortOrder: index,
          })),
        },
        notificationRules: {
          create: (seed.notifications ?? []).map((rule) => ({
            offsetDays: rule.offsetDays,
            timeOfDay: rule.timeOfDay,
            offsetUnit: rule.offsetUnit ?? "CALENDAR_DAY",
            channels: JSON.stringify(rule.channels),
            isOverdueReminder: rule.isOverdueReminder ?? false,
            repeatIntervalHours: rule.repeatIntervalHours ?? null,
            maxRepeats: rule.maxRepeats ?? null,
          })),
        },
      },
      select: { id: true },
    });

    keyToId.set(seed.key, task.id);
  }

  console.log(`✅ 업무 ${TASK_SEEDS.length}건`);
  return keyToId;
}

async function seedDependencies(taskIds: Map<string, string>): Promise<void> {
  let count = 0;

  for (const seed of DEPENDENCY_SEEDS) {
    const predecessorId = taskIds.get(seed.predecessor);
    const successorId = taskIds.get(seed.successor);
    if (!predecessorId || !successorId) continue;

    await prisma.taskDependency.create({
      data: {
        predecessorId,
        successorId,
        lagAmount: seed.lagAmount,
        lagUnit: seed.lagUnit,
        matchStrategy: seed.matchStrategy,
        isBlocking: seed.isBlocking,
        note: seed.note,
      },
    });
    count += 1;
  }

  console.log(`✅ 의존 관계 ${count}건`);
}

async function generateOccurrences(taskIds: Map<string, string>): Promise<void> {
  let total = 0;

  for (const taskId of taskIds.values()) {
    const result = await syncOccurrencesForTask(taskId, { today: TODAY });
    total += result.created;
    if (result.error) {
      console.warn(`   ⚠️  ${result.taskTitle}: ${result.error}`);
    }
  }

  console.log(`✅ 발생 건 ${total}건 생성 (기준일 ${TODAY})`);
}

/**
 * 과거 회차에 현실적인 처리 상태를 부여한다.
 *
 * 아무것도 하지 않으면 과거 회차 전체가 "지연"으로 표시되어
 * 대시보드가 온통 빨간색이 된다. 실제 사용 중인 모습에 가깝게 만든다.
 */
async function applyRealisticHistory(): Promise<void> {
  const past = await prisma.occurrence.findMany({
    where: { scheduledDate: { lt: toDbDate(TODAY) } },
    select: { id: true, taskId: true, scheduledDate: true },
    orderBy: { scheduledDate: "asc" },
  });

  let done = 0;
  let overdue = 0;
  let inProgress = 0;

  for (const [index, occurrence] of past.entries()) {
    const scheduled = toPlainDate(occurrence.scheduledDate);
    const daysAgo = diffInDays(TODAY, scheduled);

    // 최근 5일 이내 마감 건 일부는 아직 진행중으로 남겨 둔다.
    if (daysAgo <= 5 && index % 4 === 0) {
      await prisma.occurrence.update({
        where: { id: occurrence.id },
        data: { status: "IN_PROGRESS", startedAt: new Date() },
      });
      inProgress += 1;
      continue;
    }

    // 약 8%는 미완료로 남겨 "지연" 상태를 재현한다.
    if (index % 12 === 5) {
      overdue += 1;
      continue;
    }

    // 나머지는 완료 처리. 대부분 마감일 당일~1일 전, 일부는 하루 늦게.
    const completionOffset = index % 7 === 3 ? 1 : index % 3 === 0 ? -1 : 0;
    const completedDate = addDays(scheduled, completionOffset);

    await prisma.occurrence.update({
      where: { id: occurrence.id },
      data: {
        status: "DONE",
        // 완료 시각은 해당 날짜 오후 5시(KST)로 둔다.
        completedAt: new Date(`${completedDate}T08:00:00.000Z`),
        startedAt: new Date(`${addDays(completedDate, -1)}T00:00:00.000Z`),
        ...(index % 9 === 2
          ? { memo: "특이사항 없이 정상 처리했습니다." }
          : index % 15 === 7
            ? { memo: "자료 수취가 늦어 하루 지연되었습니다. 다음 회차에는 사전 요청 일정을 앞당길 예정." }
            : {}),
      },
    });

    // 완료된 회차의 체크리스트도 체크 처리
    await prisma.checklistItem.updateMany({
      where: { occurrenceId: occurrence.id },
      data: { isChecked: true, checkedAt: new Date(`${completedDate}T08:00:00.000Z`) },
    });

    done += 1;
  }

  // 진행중 회차의 체크리스트를 일부만 체크해 진행률을 만든다.
  const inProgressRows = await prisma.occurrence.findMany({
    where: { status: "IN_PROGRESS" },
    select: { id: true, checklist: { select: { id: true }, orderBy: { sortOrder: "asc" } } },
  });

  for (const row of inProgressRows) {
    const half = Math.floor(row.checklist.length / 2);
    if (half === 0) continue;
    await prisma.checklistItem.updateMany({
      where: { id: { in: row.checklist.slice(0, half).map((c) => c.id) } },
      data: { isChecked: true, checkedAt: new Date() },
    });
  }

  console.log(
    `✅ 과거 이력 반영 — 완료 ${done} · 진행중 ${inProgress} · 미완료(지연) ${overdue}`,
  );
}

async function seedSettings(users: Map<string, string>): Promise<void> {
  const defaults: { key: string; value: string }[] = [
    { key: "rollingWindowMonths", value: "18" },
    { key: "staleNotificationHours", value: "48" },
  ];

  const firstUser = users.get("김서연");
  if (firstUser) defaults.push({ key: "currentUserId", value: firstUser });

  for (const setting of defaults) {
    await prisma.appSetting.upsert({
      where: { key: setting.key },
      create: setting,
      update: {}, // 이미 설정된 값은 덮어쓰지 않는다
    });
  }

  console.log("✅ 기본 설정");
}

async function main(): Promise<void> {
  console.log("");
  console.log("━".repeat(60));
  console.log(`시드 데이터 생성 시작 (기준일: ${TODAY})`);
  console.log("━".repeat(60));

  await seedHolidays();
  const users = await seedUsers();
  const { categories, tags } = await seedTaxonomy();
  await seedSettings(users);

  const taskIds = await seedTasks(users, categories, tags);
  await seedDependencies(taskIds);
  await generateOccurrences(taskIds);
  await applyRealisticHistory();

  console.log("━".repeat(60));
  console.log("완료. `npm run dev` 로 대시보드를 확인하세요.");
  console.log("━".repeat(60));
  console.log("");
}

main()
  .catch((error) => {
    console.error("시드 실패:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
