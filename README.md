# 사내 정기 업무 관리 대시보드

매년·매분기·매월 반복되는 **정형 업무**를 1년 단위로 조망하고 놓치지 않도록 관리하는 웹 애플리케이션입니다.

일반적인 To-Do 앱이 "당장 처리할 일"을 나열하는 도구라면, 이 앱은 연말정산 자료 취합, 분기 결산,
월 마감, 라이선스 갱신, 정기 점검처럼 **매년 같은 시점에 반복되는 업무**를 관리하는 데 초점을 둡니다.

---

## 빠른 시작

```bash
npm install && npm run setup && npm run dev
```

`http://localhost:3000` 에서 접속합니다.

세 단계가 하는 일:

| 명령 | 동작 |
|---|---|
| `npm install` | 의존성 설치 + Prisma 클라이언트 생성 (postinstall) |
| `npm run setup` | SQLite DB 생성 + 시드 데이터 (공휴일 5개 연도, 사내 정기 업무 23건) |
| `npm run dev` | 개발 서버 + 알림 스케줄러 시작 |

> **외부 서비스 설정이 필요하지 않습니다.** DB 는 파일 기반 SQLite 이고, 이메일은 기본적으로
> 콘솔에 출력됩니다(`EMAIL_TRANSPORT="console"`). `.env` 는 비밀정보가 없어 저장소에 포함되어 있습니다.

### 비밀정보 설정

SMTP 비밀번호처럼 커밋하면 안 되는 값은 `.env.local` 에 넣습니다.
Next.js 와 Prisma 설정 모두 `.env` → `.env.local` 순으로 읽으므로 `.env.local` 이 우선합니다.

```bash
# .env.local (gitignore 대상)
EMAIL_TRANSPORT="smtp"
SMTP_HOST="smtp.example.co.kr"
SMTP_USER="notice@example.co.kr"
SMTP_PASS="********"
```

### DB 초기화

```bash
npm run db:reset
```

DB 를 비우고 스키마를 다시 만든 뒤 시드 데이터를 넣습니다.

---

## 핵심 설계: 업무 정의와 발생 건의 분리

이 앱의 모든 구조는 다음 한 가지 분리에서 출발합니다.

```
Task (업무 정의 = 템플릿)          Occurrence (발생 건 = 실제 실행 단위)
─────────────────────────         ────────────────────────────────────
"매월 5일 급여 마감"        →      2026-01-05 급여 마감  [완료]
  · 반복 규칙                      2026-02-05 급여 마감  [완료]
  · 설명 (Markdown)                2026-03-05 급여 마감  [진행중]
  · 체크리스트 템플릿               2026-04-05 급여 마감  [예정]
  · 알림 규칙                      ...
```

- 완료/미완료, 담당자 변경, 메모, 체크리스트는 모두 **Occurrence 단위**로 기록됩니다.
- `Task` 의 반복 규칙을 수정해도 **이미 완료·건너뜀 처리된 회차와 마감일이 지난 회차는 변경되지 않습니다.**
- 덕분에 "작년 연말정산 취합은 누가 했고 언제 끝냈나" 같은 질문에 답할 수 있습니다.

자세한 설계 근거는 [`DECISIONS.md`](DECISIONS.md) 를 참고하세요.

---

## 기능

### 반복 주기

| 종류 | 예시 |
|---|---|
| 매년 | 매년 1월 31일, 매년 12월 말일, 격년 7월 1일 |
| 매월 | 매월 5일, 매월 말일, 격월 10일 |
| 매월 N번째 요일 | 매월 셋째 주 화요일, 매월 마지막 금요일 |
| 매분기 | 분기 종료 후 10**영업일**, 분기 시작 5일 전, 회계연도 4월 시작 |
| 특정 월 복수 지정 | 3·6·9·12월 15일, 1·4·7·10월 25일 |
| 매주 / 격주 / N주마다 | 매주 월·수·금, 격주 화요일 |
| N일마다 | 10일마다, 45일마다 |
| 1회성 | 특정 날짜 1회 |

추가 옵션:

- **반복 시작일 / 종료일 / 총 반복 횟수** 제한
- **1회성 예외**: 특정 회차만 날짜 변경 또는 건너뛰기
- **존재하지 않는 날짜 처리**: "매월 31일"의 2월을 말일로 당길지, 건너뛸지

### 한국 업무 환경 대응

- 타임존은 `Asia/Seoul` 고정
- 마감일이 주말/공휴일인 경우: `그대로 유지` / `직전 영업일로 앞당김` / `다음 영업일로 미룸`
- 이동 대상도 선택 가능: `주말+공휴일` / `주말만` / `공휴일만`
  (공휴일에도 돌아가는 자동 배치 업무를 위해)
- 공휴일 데이터는 `data/holidays/<연도>.json` 으로 분리 — 음력 기반 공휴일과 대체공휴일 대응

### 선행/후행 업무 (의존관계)

- 하나의 업무에 선행·후행을 **다중 등록**
- 전체 구조는 DAG이며 **순환 참조는 등록 시점에 차단**되고, 에러 메시지에 순환 경로가 표시됩니다
  (예: `순환 참조가 발생합니다: 급여대장 확정 → 급여 이체 실행 → 급여대장 확정`)
- 선행 미완료 시 후행은 `대기(BLOCKED)` 로 표시
- 의존 관계에 **오프셋(lag)** 설정 — 예: 선행 완료 후 3영업일 뒤 시작
- 선행이 지연되면 후행 마감일 초과 예상을 **경고로 표시**
- 업무 상세에서 **의존 관계 그래프 시각화**
- 회차 단위 오버라이드로 주기가 다른 업무도 연결 가능

### 알림

- 업무별로 알림 시점 **복수 지정** (예: D-7 09:00, D-1 18:00, 당일 09:00)
- 오프셋을 **영업일 기준**으로도 지정 가능
- 마감 초과 시 **미완료 리마인더 반복 발송** (간격·최대 횟수 설정)
- **선행 업무 완료 시 후행 담당자에게 알림**
- 백엔드 cron 스케줄러로 동작하며 **서버 재시작 후에도 누락 없이 재개**
- 발송 채널은 **어댑터 패턴으로 추상화** — 1차로 브라우저 알림 + 이메일 구현
- 발송 이력 저장 (중복 발송 방지 포함)

### 화면

| 경로 | 설명 |
|---|---|
| `/` | **연간 대시보드** — 12개월 × 업무 그리드, 상태별 색상, 연도 전환 |
| `/month` | **월간 뷰** — 캘린더 / 리스트 토글, 공휴일 표시 |
| `/tasks` | **업무 목록** — 업무 정의 관리 (보관된 업무 포함) |
| `/tasks/[id]` | **업무 상세** — 설명, 체크리스트, 의존 그래프, 과거 이력, 알림 설정 |
| `/tasks/new`, `/tasks/[id]/edit` | **등록/수정 폼** — 반복 규칙 설정 시 **다음 10회 발생 예정일 실시간 미리보기** |
| `/settings` | **운영 상태** — 스케줄러 상태, 공휴일 커버리지, 알림 이력, 배치 수동 실행 |

모든 화면에서 담당자·카테고리·태그·상태·중요도 필터를 쓸 수 있고, 필터 상태는 URL 에 보관되어
새로고침·뒤로가기·링크 공유가 자연스럽게 동작합니다.

---

## 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | Next.js 16 (App Router) + React 19 | |
| 언어 | TypeScript (strict) | |
| DB | SQLite + Prisma 6 | PostgreSQL 전환 가능하게 스키마 작성 |
| UI | Tailwind CSS v4 + shadcn/ui | |
| 날짜 처리 | `date-fns` + `@date-fns/utc` + `@date-fns/tz` | Temporal 폴리필 대신 |
| 검증 | Zod | |
| 스케줄러 | `node-cron` + Next.js `instrumentation.ts` | 별도 워커 프로세스 불필요 |
| 테스트 | Vitest | 248개 단위 테스트 |

---

## 프로젝트 구조

```
src/
├── lib/
│   ├── date/                    ← 날짜 계산 (순수 함수, 테스트 완비)
│   │   ├── plain-date.ts        · "YYYY-MM-DD" 달력 날짜 연산
│   │   ├── business-day.ts      · 주말/공휴일 고려 영업일 계산
│   │   └── kst.ts               · Asia/Seoul 시각 변환
│   │
│   ├── recurrence/              ← 반복 일정 엔진 (순수 함수)
│   │   ├── types.ts             · RecurrenceConfig 스키마 (Zod)
│   │   ├── engine.ts            · Task → Occurrence 날짜 계산
│   │   └── describe.ts          · 규칙 → 한국어 설명
│   │
│   ├── dependency/              ← 의존관계 (순수 함수)
│   │   ├── graph.ts             · 순환 검증, 위상 정렬, 레이아웃
│   │   └── status.ts            · blocked 판정, 지연 영향 분석
│   │
│   ├── notification/            ← 알림
│   │   ├── planner.ts           · 발송 계획 계산 (순수 함수)
│   │   ├── dispatcher.ts        · 실제 발송 + 이력 기록
│   │   ├── scheduler.ts         · cron 등록
│   │   ├── registry.ts          · 채널 어댑터 레지스트리
│   │   └── adapters/            · web-push.ts, email.ts
│   │
│   └── services/                ← DB 접근 계층
│       ├── occurrence-service.ts       · 롤링 회차 생성/동기화
│       ├── dashboard-service.ts        · 연간/월간 조회
│       ├── task-service.ts             · 업무 CRUD, 의존관계
│       └── ...
│
├── app/                         ← 페이지 + API 라우트
├── components/                  ← UI 컴포넌트
└── instrumentation.ts           ← 서버 부팅 시 스케줄러 시작

prisma/
├── schema.prisma                ← 데이터 모델 (한국어 주석)
└── seed.ts                      ← 시드 데이터 (사내 정기 업무 23건)

data/holidays/
├── 2024.json ~ 2028.json        ← 공휴일 데이터
└── README.md                    ← 갱신 절차
```

### 계층 규칙

**`lib/date`, `lib/recurrence`, `lib/dependency`, `lib/notification/planner` 는 순수 함수만 포함합니다.**
DB, 현재 시각, 로컬 타임존에 의존하지 않으며 모든 입력을 인자로 받습니다.
덕분에 모든 경계 조건을 DB 없이 결정적으로 테스트할 수 있습니다.

---

## 테스트

```bash
npm test           # 1회 실행
npm run test:watch # 감시 모드
```

**248개 테스트**가 다음을 검증합니다.

| 파일 | 검증 내용 |
|---|---|
| `plain-date.test.ts` | 윤년, 월말 절삭, N번째 요일, 주 경계 |
| `business-day.test.ts` | 영업일 가산, 연휴 건너뛰기, 이동 대상 옵션 |
| `engine.test.ts` | 9종 반복 규칙 전체, 말일·윤년·5번째 요일, 공휴일 이동, 1회성 예외, 종료 조건, 회차 번호 불변성 |
| `graph.test.ts` | 순환 탐지(직접·간접·자기참조), 위상 정렬, 그래프 레이아웃 |
| `status.test.ts` | 회차 매칭 3전략, blocked 판정, lag 기반 지연 영향 분석 |
| `planner.test.ts` | 알림 시점 계산, 서버 재시작 후 재개, 낡은 알림 폐기, 지연 리마인더 폭주 방지 |
| `describe.test.ts` | 규칙 → 한국어 문구 변환, "날짜 없는 달" 판정 |

### 타임존 안전성 검증

`vitest.config.ts` 는 **`TZ=America/Los_Angeles`** (KST와 17시간 차)를 강제합니다.
이 상태에서 모든 테스트가 통과하므로, 로컬 타임존이 날짜 계산에 새어 들어가지 않음이 보장됩니다.
KST 환경에서만 테스트하면 이 클래스의 버그를 절대 잡을 수 없습니다.

---

## 운영

### 스케줄러

서버가 시작되면 `src/instrumentation.ts` 가 스케줄러를 자동으로 띄웁니다. 별도 워커 프로세스가 필요 없습니다.

| 작업 | 기본 주기 | 환경변수 |
|---|---|---|
| 알림 발송 점검 | 매 분 | `SCHEDULER_CRON` |
| 회차 롤링 생성 | 매일 04:10 | `GENERATION_CRON` |

부팅 시에는 cron 의 첫 틱을 기다리지 않고 **즉시 한 번 실행**해 재시작 직후의 공백을 없앱니다.

**서버 재시작 후 누락 없는 재개**: 스케줄러는 발송 이력을 메모리에 두지 않습니다.
매 틱마다 DB 를 보고 "보내야 하는데 아직 발송 기록이 없는 알림"을 찾아 처리하므로,
서버가 얼마나 오래 정지했든 재시작 직후 첫 틱에서 놓친 알림이 자동으로 발견됩니다.
복구가 정상 동작과 같은 경로이므로 별도의 복구 로직이 없습니다.

단, `staleNotificationHours`(기본 48시간)를 넘긴 알림은 폭주를 막기 위해 발송하지 않고
`SKIPPED_STALE` 로 이력만 남깁니다 — 왜 오지 않았는지 추적할 수 있어야 하기 때문입니다.

스케줄러를 끄려면 `.env` 에 `SCHEDULER_ENABLED="false"` 를 설정합니다.
`/settings` 화면에서 배치를 수동 실행할 수도 있습니다.

### 이메일 발송

`.env` 의 `EMAIL_TRANSPORT` 로 선택합니다.

| 값 | 동작 |
|---|---|
| `console` (기본) | 콘솔에 출력만 — SMTP 설정 없이 즉시 확인 가능 |
| `file` | `.mail-outbox/` 에 `.eml` 파일로 저장 |
| `smtp` | 실제 발송 (`SMTP_HOST` 등 필요) |

### Slack / Teams 추가하기

어댑터 패턴으로 추상화되어 있어 다음 2단계로 끝납니다.

1. `src/lib/notification/adapters/slack.ts` 에 `NotificationChannelAdapter` 구현
2. `src/lib/notification/registry.ts` 의 `ADAPTERS` 배열에 추가

스케줄러·중복방지·이력저장·API·UI 는 **수정하지 않습니다.** 채널 목록은 UI 에 자동으로 나타납니다.

```ts
// src/lib/notification/adapters/slack.ts
export const slackAdapter: NotificationChannelAdapter = {
  id: "SLACK",
  label: "Slack",
  description: "Slack 채널로 발송합니다.",
  isAvailable: () => process.env.SLACK_WEBHOOK_URL
    ? { ok: true }
    : { ok: false, reason: "SLACK_WEBHOOK_URL 이 설정되지 않았습니다." },
  async send(payload) { /* webhook 호출 */ },
};
```

### 공휴일 데이터 갱신

한국천문연구원이 매년 6~7월경 다음 해 「월력요항」을 발표합니다. 발표 후:

1. `data/holidays/<연도>.json` 파일 생성
2. `npm run db:seed` 실행 (날짜 기준 upsert 이므로 기존 데이터는 중복되지 않습니다)

데이터가 없는 연도는 대시보드 상단과 `/settings` 에 경고가 표시됩니다.
자세한 절차와 대체공휴일 규칙 표는 [`data/holidays/README.md`](data/holidays/README.md) 참고.

> **2028년 데이터는 추정치입니다.** 월력요항 미발표 상태이며, 특히 추석과 개천절이 겹치는
> 2028-10-03 의 대체공휴일 일수는 재확인이 필요합니다. 해당 파일의 `_meta.uncertain` 참고.

### PostgreSQL 전환

스키마는 SQLite 가 지원하지 않는 기능(enum, 스칼라 배열, provider별 native type)을 쓰지 않았습니다.

1. `prisma/schema.prisma` 의 `datasource.provider` 를 `"postgresql"` 로 변경
2. `.env` 의 `DATABASE_URL` 교체
3. `npm run db:push && npm run db:seed`

---

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | DB 접속 문자열 |
| `SCHEDULER_ENABLED` | `true` | 스케줄러 자동 시작 |
| `SCHEDULER_CRON` | `* * * * *` | 알림 점검 주기 (Asia/Seoul) |
| `GENERATION_CRON` | `10 4 * * *` | 회차 생성 배치 주기 |
| `EMAIL_TRANSPORT` | `console` | `console` / `file` / `smtp` |
| `EMAIL_FROM` | — | 발신자 |
| `SMTP_HOST` 등 | — | `smtp` 모드에서만 사용 |
| `APP_BASE_URL` | `http://localhost:3000` | 알림 메일의 링크 도메인 |

---

## 알려진 제약

- **인증 없음.** 로컬 단독 사용을 전제합니다. `User` 테이블과 담당자 지정은 그대로 두었고
  `User.externalId`(유니크)를 미리 두어 SSO 연동 시 스키마 변경이 필요 없게 했습니다.
  "현재 사용자"는 `AppSetting.currentUserId` 로 지정됩니다.
- **브라우저 알림은 폴링 방식**입니다. Web Push Protocol(VAPID + Service Worker)을 쓰지 않아
  브라우저가 대시보드를 열고 있을 때만 알림이 표시됩니다. 이유는
  [`adapters/web-push.ts`](src/lib/notification/adapters/web-push.ts) 주석 참고.
- **주말은 토·일 고정**입니다. 조직별 커스터마이즈는 `createHolidayCalendar` 의 `weekendDays`
  옵션으로 이미 가능하지만 UI 로 노출하지 않았습니다.
- 반복 시작일이 과거인 업무를 등록하면 **과거 회차도 함께 생성**되며 미완료 상태(=지연)로 표시됩니다.
  과거 이력이 필요 없다면 반복 시작일을 오늘로 설정하세요.

---

## 시드 데이터

`npm run db:seed` 는 현실적인 사내 정기 업무 **23건**을 생성합니다.

| 카테고리 | 업무 |
|---|---|
| 결산·세무 | 월 결산 전표 마감, 원천세 신고, 부가가치세 신고, 분기 결산 보고서, 분기 경영실적 보고, 법인세 신고 |
| 인사·급여 | 급여대장 확정, 급여 이체 실행, 4대보험 취득·상실 신고, 연말정산 자료 취합, 건강검진 관리 |
| IT 인프라 | 서버 백업 복구 검증, 보안 패치 적용, SSL 인증서 점검, 라이선스 갱신 점검, 개인정보 접속기록 점검 |
| 법무·계약 | 계약서 만료 검토, 법인등기 점검 |
| 총무·안전 | 소방시설 자체점검, 정보보호 교육, 재고 실사, 사무용품 발주, 재난 대응 모의훈련 |

각 업무에는 실제 업무 절차·주의사항·담당 부서 연락처가 Markdown 으로 작성되어 있고,
의존 관계 8건과 알림 규칙이 함께 설정됩니다. 과거 회차에는 현실적인 완료/진행중/지연 상태가 부여됩니다.

의존 관계 예시:

```
급여대장 확정 ──(같은 달 매칭)──→ 급여 이체 실행 ──→ 원천세 신고·납부
      └──────────────────────────→ 4대보험 취득·상실 신고

월 결산 전표 마감 ──(+2영업일)──→ 분기 결산 보고서 ──(+3영업일)──→ 분기 경영실적 보고
```

---

## 스크립트

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 (스케줄러 포함) |
| `npm run build` / `npm start` | 프로덕션 빌드 / 실행 |
| `npm test` | 단위 테스트 |
| `npm run lint` | ESLint |
| `npm run setup` | DB 생성 + 시드 (최초 1회) |
| `npm run db:push` | 스키마를 DB 에 반영 |
| `npm run db:seed` | 시드 데이터 |
| `npm run db:reset` | DB 초기화 + 시드 |
| `npm run db:studio` | Prisma Studio (DB 브라우저) |

---

## 문서

| 문서 | 내용 |
|---|---|
| `README.md` (이 문서) | 앱을 **쓰는 법** — 설치, 기능, 운영 |
| [`HANDOFF.md`](HANDOFF.md) | **이어받는 사람을 위한 인수인계** — 깨뜨리면 안 되는 불변식, 환경 함정, 미완성 부분, 개선 우선순위 |
| [`DECISIONS.md`](DECISIONS.md) | 왜 그렇게 **설계했는지** — 26개 항목, 검토했지만 채택하지 않은 대안 포함 |
| [`data/holidays/README.md`](data/holidays/README.md) | 공휴일 데이터 갱신 절차, 대체공휴일 규칙표 |
| [`prisma/schema.prisma`](prisma/schema.prisma) | 데이터 모델 (한국어 주석 포함) |

> **코드를 수정하기 전에 [`HANDOFF.md`](HANDOFF.md) 의 3절 "절대 깨뜨리면 안 되는 불변식"을 먼저 읽으세요.**
> 어기면 컴파일은 되지만 조용히 잘못된 결과를 내는 항목들입니다.
