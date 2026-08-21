# 인수인계 문서 (HANDOFF)

> **이 문서의 목적**
> 다른 세션·다른 계정에서 이 프로젝트를 이어받는 사람(또는 AI 에이전트)이
> **시행착오를 반복하지 않도록** 남기는 기록입니다.
>
> - `README.md` = 이 앱을 **쓰는 법**
> - `DECISIONS.md` = 왜 그렇게 **설계했는지** (26개 항목)
> - `HANDOFF.md` (이 문서) = **깨뜨리면 안 되는 것**, 함정, 미완성 부분, 개선 우선순위
>
> 작성 시점: 2026-08-21 · 커밋 `a2ecc7b` 기준

---

## 1. 30초 요약

| 항목 | 상태 |
|---|---|
| 요구사항 7단계 | 전부 구현 완료 |
| 단위 테스트 | **248개 통과** (순수 함수 계층만) |
| 타입 검사 (`tsc --noEmit`) | 클린 |
| 린트 (`eslint .`) | 클린 (경고 0) |
| 프로덕션 빌드 | 성공 |
| 서비스/API/UI 테스트 | **없음** ← 가장 큰 빈틈 |
| 인증 | 없음 (의도적, 로컬 단독 사용 전제) |
| 저장소 | https://github.com/Quasarparkk/recurring-task-dashboard (Public) |

**한 문장 요약**: 날짜 계산·반복 규칙·의존관계·알림 계획은 순수 함수로 분리해 촘촘히 테스트했고,
그 위의 DB/UI 계층은 수동 검증만 했습니다.

---

## 2. 실행 및 검증

```bash
npm install && npm run setup && npm run dev
```

작업 후 반드시 이 4개를 통과시킬 것:

```bash
npm test                # 248개 통과해야 함
npx tsc --noEmit        # 출력 없어야 함
npx eslint .            # 출력 없어야 함
npm run build           # 성공해야 함
```

> `npm run lint` 는 `eslint` 를 인자 없이 호출합니다. 전체 검사는 `npx eslint .` 를 쓰세요.

---

## 3. ⚠️ 절대 깨뜨리면 안 되는 불변식

**이 절이 이 문서에서 가장 중요합니다.** 아래 항목들은 어기면 컴파일은 되지만
**조용히 잘못된 결과**를 냅니다. 테스트가 잡아주는 것도 있고, 못 잡는 것도 있습니다.

### 3-1. 순수 함수 계층에 DB·시각·타임존을 끌어들이지 말 것

다음 디렉토리는 **순수 함수만** 있습니다. `prisma`, `new Date()`(인자 없이), `process.env` 를
여기서 쓰면 안 됩니다.

```
src/lib/date/            plain-date.ts, business-day.ts   (kst.ts 는 예외 — 3-2 참고)
src/lib/recurrence/      types.ts, engine.ts, describe.ts
src/lib/dependency/      graph.ts, status.ts
src/lib/notification/    planner.ts                        (dispatcher.ts 는 DB 계층)
```

"오늘"이나 공휴일이 필요하면 **인자로 받습니다.** 이 규칙 덕분에 248개 테스트가
DB 없이 결정적으로 돌아갑니다. 편의를 위해 여기서 `prisma` 를 import 하는 순간
테스트 전체가 무너집니다.

### 3-2. `vitest.config.ts` 의 `TZ=America/Los_Angeles` 를 지우지 말 것

```ts
env: { TZ: "America/Los_Angeles" }   // KST와 17시간 차
```

**의도적으로 KST가 아닌 타임존을 강제**합니다. 이 상태에서 테스트가 통과해야
"로컬 타임존이 날짜 계산에 새어 들어가지 않음"이 증명됩니다.
KST에서만 테스트하면 이 클래스의 버그를 **절대** 잡을 수 없습니다.

`plain-date.test.ts` 첫 블록에 이 전제를 검사하는 테스트가 있습니다:

```ts
expect(new Date().getTimezoneOffset()).not.toBe(-540);  // -540 = KST
```

### 3-3. 달력 날짜와 실제 시각을 섞지 말 것

| 종류 | 예 | 타입 | 저장 |
|---|---|---|---|
| **달력 날짜** | 마감일 | `PlainDate` = `"YYYY-MM-DD"` 문자열 | `DateTime` @ **UTC 자정** |
| **실제 시각** | 완료 시각, 알림 발송 | `Date` | UTC 타임스탬프 |

DB에서 달력 날짜를 읽을 때는 **반드시 `toPlainDate()`** 를 쓰세요 (내부적으로 UTC getter 사용).
`date.getFullYear()` 같은 로컬 getter를 쓰면 타임존에 따라 하루가 밀립니다.

```ts
// ✅ 올바름
const d = toPlainDate(row.scheduledDate);
// ❌ 하루 밀릴 수 있음
const d = row.scheduledDate.toISOString().slice(0, 10);   // UTC라 괜찮아 보이지만 규약 위반
const d = format(row.scheduledDate, "yyyy-MM-dd");        // 로컬 타임존 → 위험
```

### 3-4. `BLOCKED` / `OVERDUE` 를 DB에 저장하지 말 것

`Occurrence.status` 에는 `PENDING | IN_PROGRESS | DONE | SKIPPED` **만** 들어갑니다.

- `OVERDUE` 는 "오늘"에 따라 달라짐 → 저장하면 날짜 바뀌는 순간 낡은 값
- `BLOCKED` 는 선행 완료 여부에 따라 달라짐 → 저장하면 연쇄 UPDATE 정합성 문제

조회 시 `computeDerivedStatuses()` 로 계산합니다. "성능 최적화"를 이유로
이걸 컬럼으로 빼려는 시도가 나올 수 있는데, **하지 마세요.** 계산 비용은 낮고
정합성 리스크는 높습니다. (DECISIONS D-006)

### 3-5. `sequenceIndex` 는 항상 `config.startDate` 부터 0번

조회 범위를 좁혀도 번호는 안 변합니다. `SKIP` 예외로 제외된 회차도 **번호를 소비**합니다.
`SAME_SEQUENCE` 매칭과 `maxOccurrences` 판정이 이 불변성에 의존합니다.

`engine.test.ts` 의 "회차 번호(sequenceIndex) 불변성" 블록이 이걸 지킵니다.

### 3-6. 1회성 예외의 키는 `originalDate` (회차 번호 아님)

회차 번호를 키로 쓰면 규칙 수정 시 **엉뚱한 회차에 예외가 적용**됩니다.
원본 날짜를 키로 쓰면 그 날짜가 더는 생성되지 않을 때 예외가 조용히 무효화됩니다
— 잘못 적용되는 것보다 훨씬 안전한 실패 모드입니다. (DECISIONS D-008)

### 3-7. 과거 이력 보호 규칙

`occurrence-service.ts` 의 `isMutable()` 이 지키는 규칙:

```
status ∈ (DONE, SKIPPED)  →  절대 변경/삭제 금지
scheduledDate < today     →  절대 변경/삭제 금지 (이미 지난 이력)
```

반복 규칙 수정은 **미래의 미확정 회차에만** 반영됩니다. 이게 이 앱의 존재 이유입니다.

### 3-8. 회차 마감일을 바꾸면 반복 규칙에 예외를 함께 기록해야 함

`updateOccurrence()` → `recordRescheduleException()`.
이걸 빼먹으면 다음 롤링 배치가 규칙대로 날짜를 **되돌려 버립니다.**
사용자 입장에서 "분명히 바꿨는데 다음 날 원래대로 돌아가 있는" 최악의 버그입니다.

### 3-9. 알림 발송 계획을 테이블에 materialize 하지 말 것

현재는 매 틱마다 "보내야 하는데 `NotificationLog` 에 없는 알림"을 계산합니다.
이 구조 덕분에 **서버 재시작 후 복구가 정상 동작과 같은 경로**여서 별도 복구 로직이 없습니다.

materialize 하는 쪽으로 바꾸면 규칙/마감일 변경 시 재생성 로직이 필요해지고,
그 로직의 버그가 곧 알림 누락/중복이 됩니다. (DECISIONS D-015)

---

## 4. 환경 특이사항 (내가 시간을 쓴 함정들)

이 프로젝트를 세팅하면서 실제로 부딪힌 문제들입니다. 재현될 가능성이 높습니다.

### 4-1. 폴더명 대문자 → `create-next-app` 실패

`Job_Dashboard` 에 대문자가 있어서 npm 이름 규칙 위반으로 스캐폴딩이 거부됩니다.
소문자 임시 하위 폴더(`tmp-scaffold`)에 만든 뒤 파일을 올려서 해결했습니다.
`package.json` 의 `name` 은 `job-dashboard` 로 고정해 뒀습니다. **바꾸지 마세요.**

### 4-2. npm 11.17+ 가 install script 를 기본 차단

Prisma 엔진 바이너리 다운로드와 esbuild 설치가 postinstall 에 의존합니다.
`package.json` 의 `allowScripts` 필드로 승인해 뒀습니다:

```json
"allowScripts": {
  "prisma@6.19.3": true,
  "@prisma/engines@6.19.3": true,
  "@prisma/client@6.19.3": true,
  "esbuild@0.28.2": true,
  "unrs-resolver@1.12.2": true
}
```

⚠️ **버전을 올리면 키의 버전도 같이 바꿔야 합니다.** 안 바꾸면 `npm install` 후
`prisma generate` 가 실패하거나 vitest 가 esbuild 없이 죽습니다.

### 4-3. `prisma.config.ts` 가 `.env` 자동 로딩을 끈다 ← 특히 주의

설정 파일이 존재하면 Prisma CLI 가 `.env` 를 **읽지 않습니다.**
로그에 `Prisma config detected, skipping environment variable loading` 이 찍힙니다.

`prisma.config.ts` 상단에서 `process.loadEnvFile()` 로 직접 로드합니다.
**이 부분을 지우면 `npm run setup` 이 `Environment variable not found: DATABASE_URL` 로 실패합니다**
— 신규 사용자가 실행하는 첫 명령이라 치명적입니다.

로드 순서는 `.env.local` → `.env` (먼저 읽은 값이 유지되므로 `.env.local` 이 우선).

### 4-4. dev 서버가 Prisma 엔진 DLL을 잠근다

`npm run dev` 실행 중에 `prisma generate` 를 돌리면:

```
EPERM: operation not permitted, rename '...query_engine-windows.dll.node.tmp...'
```

**dev 서버를 먼저 끄세요.** 스키마를 바꿨을 때 흔히 겪습니다.

### 4-5. Prisma 페이지는 기본적으로 정적 생성된다

Next.js 는 Prisma 호출을 동적 신호로 인식하지 못합니다. `searchParams` 를 안 쓰는
DB 조회 페이지는 **빌드 시점 데이터와 날짜가 영구히 고정**됩니다.
(마감 초과 판정이 "오늘"에 의존하므로 특히 치명적)

`/settings`, `/tasks/new` 에 `export const dynamic = "force-dynamic"` 을 넣어 뒀습니다.
**새 페이지를 추가할 때 `searchParams` 를 안 쓰면 이걸 잊지 마세요.**
`npm run build` 출력에서 `○ (Static)` 으로 표시되면 의심하세요.

### 4-6. 루트 레이아웃의 `useSearchParams()` 는 Suspense 필수

`AppHeader` 가 연도 컨텍스트 유지를 위해 `useSearchParams()` 를 씁니다.
루트 레이아웃에 있으므로 `/_not-found` 정적 프리렌더가 실패합니다.
`layout.tsx` 에서 `<Suspense>` 로 감싸 해결했습니다.

### 4-7. `tsx` + CJS: 최상위 await 불가

`prisma/seed.ts` 같은 스크립트에서 top-level await 를 쓰면:

```
Top-level await is currently not supported with the "cjs" output format
```

`async function main()` + `main().catch()` 패턴을 쓰세요. seed.ts 가 그렇게 되어 있습니다.

### 4-8. shadcn CLI 인자가 바뀌었다

`--base-color` 는 없어졌습니다. 현재:

```bash
npx shadcn@latest init -b radix --no-monorepo -y -f --css-variables -p nova
npx shadcn@latest add <컴포넌트...> -y -o
```

`-b` = base(base/radix/aria), `-p` = preset(nova/vega/maia/...).

### 4-9. `eslint` 의 `react-hooks/set-state-in-effect` 는 error

effect 안에서 `setState()` 를 동기 호출하면 **경고가 아니라 에러**입니다.
브라우저 권한처럼 "브라우저가 소유한 외부 상태"는 `useSyncExternalStore` 로 읽으세요.
`notification-watcher.tsx` 가 그 예시입니다 (작은 스토어를 직접 구현).

---

## 5. 알려진 제약과 미완성 부분

### 5-1. 데이터 정확성 — 조치 필요

| 항목 | 내용 |
|---|---|
| **2028년 공휴일** | 한국천문연구원 「월력요항」 미발표 상태. 음력 날짜는 복수 출처 일치로 신뢰도 높지만 **대체공휴일은 규칙 기반 추정치**입니다. |
| **2028-10-03** | 추석과 개천절이 겹치는 특이 사례. 확인한 출처는 모두 대체공휴일 1일(10/5)로 표기하지만, 규정상 두 공휴일이 각각 대상이므로 정부가 **10/6까지 2일** 지정할 여지가 있습니다. |
| **2028-04-12** | 제23대 국회의원선거일. 공직선거법 기준 계산값이며 중앙선관위 공식 공고 전입니다. |
| **임시공휴일** | 국무회의 의결로 수시 지정됩니다. 2027·2028은 현재 없음. |

각 파일의 `_meta.verification` / `_meta.uncertain` 에 기록해 뒀습니다.
**2027년 중에 「2028년 월력요항」이 발표되면 `data/holidays/2028.json` 을 갱신하세요.**

> 조사 과정에서 확인된 법령 변경 2건 (반영 완료):
> - **노동절(5/1)이 2026년부터 법정공휴일**이자 대체공휴일 대상 (법률 제21543호)
> - **제헌절(7/17)이 18년 만에 공휴일로 부활** (2026-05-11 시행)
>
> 이건 추측으로는 절대 맞출 수 없는 부분입니다. 공휴일은 반드시 출처를 확인하세요.

### 5-2. 테스트가 없는 계층

**순수 함수만 테스트되어 있습니다.** 다음은 수동 검증만 했습니다:

| 계층 | 파일 | 위험도 |
|---|---|---|
| 서비스 (DB) | `src/lib/services/*.ts` | **높음** — 롤링 생성의 보호 규칙, 트랜잭션 경계 |
| 알림 발송 | `notification/dispatcher.ts` | **높음** — dedupe upsert 분기, 재시도 |
| API 라우트 | `src/app/api/**` | 중간 — 검증은 zod가 함 |
| UI | `src/components/**` | 낮음 — 로직이 거의 없음 |

**가장 먼저 테스트를 추가할 곳**: `occurrence-service.ts` 의 `syncOccurrencesForTask()`.
"규칙을 바꿨을 때 과거 회차가 보존되는지"가 이 앱의 핵심 계약인데
그걸 지키는 코드에 자동 테스트가 없습니다.

권장 방식: 별도 SQLite 파일(`file:./test.db`)로 Vitest 통합 테스트.
`beforeEach` 에서 `prisma db push --force-reset` 대신 테이블 truncate.

### 5-3. 스키마·서비스는 있는데 UI/API가 없는 기능

| 기능 | 스키마 | 서비스 | API | UI |
|---|---|---|---|---|
| 회차 레벨 의존 오버라이드 | ✅ `OccurrenceDependencyOverride` | ✅ `createOccurrenceOverride()` | ❌ | ❌ |
| 사내 휴무일(`COMPANY`) 등록 | ✅ `Holiday.type` | ✅ (시드 경유) | ❌ | ❌ |
| 주말 요일 커스터마이즈 | — | ✅ `weekendDays` 옵션 | ❌ | ❌ |
| 담당자/카테고리/태그 관리 | ✅ | ❌ | ❌ | ❌ (시드만) |
| 설정값 편집(롤링 윈도우 등) | ✅ `AppSetting` | ✅ `setSetting()` | ❌ | ❌ (읽기만) |

주기가 다른 업무를 회차 단위로 잇는 기능(오버라이드)은 **상태 계산 로직까지 완성되어 테스트도 있지만**
(`status.test.ts` 의 "오버라이드가 있으면 Task 레벨 매칭을 완전히 대체한다"),
등록할 화면이 없습니다. API 라우트 1개 + 다이얼로그 1개만 추가하면 됩니다.

### 5-4. 다크모드

`globals.css` 에 `.dark` 팔레트가 완비되어 있지만 **전환 UI가 없습니다.**
`next-themes` 는 설치되어 있으나 shadcn 의 `sonner.tsx` 가 `useTheme` 를 쓰는 게 전부이고
`ThemeProvider` 가 없습니다.

붙이려면: `layout.tsx` 에 `ThemeProvider` 추가 + 헤더에 토글 버튼. 30분 작업입니다.

### 5-5. 성능 — 현재 규모에선 문제없지만 알아둘 것

| 위치 | 내용 |
|---|---|
| `loadOccurrences()` | 의존관계 계산용으로 조회 범위 **±12개월**의 Occurrence를 전부 읽습니다. 업무 수백 건 규모가 되면 무거워집니다. |
| 업무 상세 이력 | 페이지네이션 없음. 주간 업무는 **112회차가 한 번에 렌더**됩니다 (`getTaskOccurrenceHistory` 에 `limit` 을 안 넘김). |
| `getTaskGraphData()` | 그래프 노드의 "대기" 표시는 **근사치**입니다 (정확한 회차 매칭을 하지 않고 "차단 관계인 선행 업무에 미완료 회차가 있음"으로 판정). 코드에 주석으로 명시해 뒀습니다. 정확한 값은 회차 상세 패널에 나옵니다. |
| 연간 대시보드 | 23업무 × 12개월 = 문제없음. 업무 100건 넘어가면 가상 스크롤 검토. |

### 5-6. 기타 사소한 것들

- **`file` 이메일 모드의 파일명 충돌**: `{occurrenceId}_{kind}.eml` 이라 같은 회차의 같은 종류 알림이 재발송되면 덮어씁니다. 디버깅 용도라 그대로 뒀습니다.
- **미사용 shadcn 컴포넌트**: `badge`, `card`, `popover`, `radio-group`, `scroll-area`, `table`, `tabs`. 표와 카드는 Tailwind 로 직접 만들었습니다. 지워도 되고 나중에 쓸 수도 있습니다.
- **과거 회차가 지연으로 표시됨**: 반복 시작일이 과거인 업무를 등록하면 과거 회차도 생성되며 미완료(=지연) 상태가 됩니다. 의도된 동작이지만 "일괄 정리" 기능이 없어 불편할 수 있습니다.
- **`AGENTS.md` / `CLAUDE.md`**: `next dev` 가 자동 생성/갱신하는 파일입니다. diff 에서 지워도 다시 살아납니다. 그냥 커밋하세요.

---

## 6. 개선 제안 (우선순위순)

### P1 — 실무 투입 전에 하면 좋은 것

1. **`syncOccurrencesForTask()` 통합 테스트** (5-2 참고)
   과거 이력 보존이 이 앱의 핵심 계약인데 자동 테스트가 없습니다.
   최소 시나리오: 회차 생성 → 일부 완료 → 규칙 변경 → 완료된 회차가 그대로인지 검증.

2. **과거 미완료 회차 일괄 처리 UI**
   월간 뷰 리스트 모드에 체크박스 + "선택한 회차 완료/건너뜀 처리".
   반복 시작일이 과거인 업무를 등록하면 즉시 필요해집니다.

3. **설정값 편집 UI** (`/settings`)
   `rollingWindowMonths`, `staleNotificationHours`, `currentUserId` 를 화면에서 바꿀 수 있게.
   서비스 함수(`setSetting`)는 이미 있으니 API 라우트 1개 + 폼만 필요합니다.

### P2 — 사용성 개선

4. **담당자/카테고리/태그 관리 화면**
   지금은 시드로만 들어갑니다. 실제로 쓰려면 사람이 바뀔 때 추가할 수 있어야 합니다.

5. **다크모드 토글** (5-4 참고, 30분)

6. **회차 레벨 의존 오버라이드 UI** (5-3 참고)
   주기가 다른 업무를 잇는 기능. 로직은 완성되어 있습니다.

7. **업무 상세 이력 페이지네이션**
   주간 업무 112회차 렌더는 낭비입니다. `limit` 을 넘기고 "더 보기" 버튼.

8. **엑셀/CSV 내보내기**
   사내 도구에서 거의 반드시 요구됩니다. 연간 그리드와 월간 리스트 2개면 충분.

### P3 — 확장

9. **Slack 어댑터**
   `adapters/slack.ts` 작성 + `registry.ts` 에 한 줄. README 에 예시 코드가 있습니다.
   스케줄러·이력·UI 는 수정 불필요.

10. **PostgreSQL 전환**
    스키마가 이미 호환됩니다. `provider` 와 `DATABASE_URL` 만 바꾸면 됩니다.
    사내 배포 시 필요.

11. **SSO 인증**
    `User.externalId`(유니크)를 미리 뒀습니다. `getCurrentUser()` 만 세션 기반으로
    교체하면 나머지는 그대로 동작합니다.

12. **진짜 Web Push**
    현재는 폴링(브라우저 열려 있을 때만). VAPID + Service Worker 로 바꾸려면
    `adapters/web-push.ts` 만 교체하면 됩니다.

13. **RRULE 내보내기**
    Google/Outlook 캘린더 연동이 필요해지면 자체 스키마 → RRULE 단방향 변환기를
    어댑터로 추가. 영업일·공휴일 규칙은 구체 날짜(`RDATE`)로 전개.

---

## 7. 파일 지도 (어디를 고쳐야 하나)

| 하고 싶은 것 | 고칠 파일 |
|---|---|
| 새 반복 규칙 종류 추가 | `recurrence/types.ts`(스키마) → `engine.ts`(`iterateCandidateDates`) → `describe.ts`(문구) → `recurrence-editor.tsx`(폼) + **테스트** |
| 공휴일 갱신 | `data/holidays/<연도>.json` → `npm run db:seed` |
| 알림 채널 추가 | `notification/adapters/<채널>.ts` + `registry.ts` 한 줄 |
| 회차 매칭 전략 추가 | `dependency/status.ts` 의 `matchCandidates()` + `MATCH_STRATEGY_LABELS` |
| 상태 색상 변경 | `app/globals.css`(토큰) + `lib/ui/status-style.ts`(매핑) |
| 연간 그리드 셀 표시 변경 | `components/year-grid.tsx` 의 `OccurrenceCell` |
| 롤링 생성 로직 변경 | `services/occurrence-service.ts` ← **3-7 보호 규칙 유지 필수** |
| 필터 항목 추가 | `validation/task-schema.ts`(`occurrenceFilterSchema`) → `dashboard-service.ts`(WHERE) → `filter-bar.tsx` |

---

## 8. 디버깅 레시피

### 회차가 예상과 다른 날짜에 생성됨

1. 업무 상세 → "반복 규칙" 배지에서 해석 결과 확인
2. 수정 폼 → 오른쪽 "다음 10회 미리보기" 에서 **"시작일부터 보기"** 켜기
   → 이동된 회차는 원본 날짜에 취소선 + 공휴일 이름이 표시됩니다
3. 여전히 이상하면 미리보기 API 직접 호출:

```bash
curl -s http://localhost:3000/api/recurrence/preview -H "Content-Type: application/json" -d '{"config":{"rule":{"type":"MONTHLY_DAY","day":1,"intervalMonths":1},"startDate":"2026-09-01","endDate":null,"maxOccurrences":null,"holidayPolicy":"PREV_BUSINESS_DAY","shiftTarget":"WEEKEND_AND_HOLIDAY","onMissingDay":"CLAMP","exceptions":[],"rollingWindowMonths":null},"count":6}'
```

응답에 `shiftReason`, `holidayName`, `isWeekendOriginal` 이 들어 있어 원인을 바로 알 수 있습니다.

### 알림이 안 옴

1. `/settings` → "최근 알림 발송 이력" 확인
   - `폐기` = 48시간 넘겨 버려짐 (`staleNotificationHours`)
   - `실패` = `error` 열에 이유 (담당자 이메일 없음, SMTP 미설정 등)
   - 아무것도 없음 = 계획 자체가 안 만들어짐 → 2번
2. `/settings` → "알림 발송 점검" 버튼으로 즉시 실행 후 출력 확인
3. 업무 상세 → "다가올 알림" 에 예정 시각이 뜨는지 확인
4. `EMAIL_TRANSPORT="console"` 이면 **dev 서버 콘솔**을 보세요 (메일이 거기 출력됩니다)

### 상태가 이상함 (대기/지연)

파생 상태는 저장되지 않으므로 DB를 봐도 안 나옵니다.
회차 상세 패널의 "선행 업무 N건이 완료되지 않았습니다" 블록에 원인 회차와
착수 예상일이 나옵니다. 우선순위는 `OVERDUE > BLOCKED > IN_PROGRESS > PENDING` 입니다
(마감 초과가 가장 시급한 경보이므로 앞에 둠).

### DB를 처음부터 다시

```bash
npm run db:reset      # 스키마 재생성 + 시드
```

---

## 9. 개발 중 실제로 발견해 고친 버그 (같은 실수 반복 방지)

| 버그 | 증상 | 원인 |
|---|---|---|
| 완료율 왜곡 | 한 업무가 **91% 대신 27%** 로 표시 | 롤링 윈도우가 미래 18개월을 미리 만드는데 그 미래 회차가 분모에 들어감. → 분모를 "마감일이 지난 회차 − 건너뛴 회차"로 수정 |
| `db:push` 실패 | `Environment variable not found: DATABASE_URL` | `prisma.config.ts` 추가가 `.env` 자동 로딩을 끔 (4-3) |
| `/settings` 데이터 고정 | 빌드 시점 값이 영구 표시 | Prisma 호출이 동적 신호로 인식되지 않아 정적 생성됨 (4-5) |
| 분기 규칙 회차 누락 | 연초에 전분기 결산이 안 생김 | "분기 종료 후 N일"은 마감일이 다음 분기에 옴. 순회를 시작 분기보다 2분기 앞에서 시작하도록 수정 (DECISIONS D-012) |
| "매개월" 표기 | 셀렉트에 이상한 한국어 | `매${unit}` 문자열 결합. 단위별 라벨 테이블로 분리 |
| 불필요한 안내 문구 | "매년 3월 31일"에 "날짜 없는 달은…" 이 붙음 | 3월은 항상 31일. `ruleCanMissTargetDay()` 로 월별 최소 일수를 따지게 수정 |

**공통 교훈**: 테스트가 4번을 잡았습니다(기대값을 잘못 쓴 게 아니라 엔진이 맞았음).
1·2·3번은 테스트가 없는 계층이라 수동 검증으로 발견했습니다. → 5-2 참고.

---

## 10. 저장소 정보

| 항목 | 값 |
|---|---|
| URL | https://github.com/Quasarparkk/recurring-task-dashboard |
| 공개 범위 | **Public** |
| 기본 브랜치 | `master` |
| 커밋 작성자 | `Quasarparrk <pjs1447@naver.com>` (git 설정값) |

⚠️ **퍼블릭 저장소이므로 커밋 이력의 이메일 주소가 공개됩니다.**
바꾸려면:

```bash
git -c user.email="원하는주소" commit --amend --reset-author --no-edit && git push --force origin master
```

GitHub noreply 주소(`{ID}+{username}@users.noreply.github.com`)를 쓰는 방법도 있습니다.

### 커밋에 포함된 `.env` 에 대해

**의도적으로 커밋했습니다.** `npm install && npm run setup && npm run dev` 만으로
실행되어야 한다는 요구사항 때문입니다. 내용은 로컬 기본값뿐입니다:

- `DATABASE_URL="file:./dev.db"` — 로컬 파일 경로
- `EMAIL_TRANSPORT="console"` — 콘솔 출력
- `SMTP_*` — **전부 빈 문자열**

실제 비밀값(SMTP 비밀번호 등)은 gitignore된 **`.env.local`** 에 넣으세요.
Next.js 와 `prisma.config.ts` 모두 `.env` → `.env.local` 순으로 읽어 `.env.local` 이 우선합니다.

푸시 전 확인한 것: 토큰/API키/개인키 패턴 스캔(0건), 실제 이메일 주소 스캔(0건,
시드는 전부 `@example.co.kr`), `prisma/dev.db`·`node_modules`·`.next` 제외 확인.

---

## 11. 요구사항 대비 이행 현황

원본 요구사항 기준 자체 점검입니다.

| 요구사항 | 상태 | 비고 |
|---|---|---|
| Task/Occurrence 분리 | ✅ | |
| 규칙 수정 시 과거 회차 불변 | ✅ | 자동 테스트는 없음 (5-2) |
| Markdown 상세 설명 | ✅ | GFM 표·체크박스 지원 |
| 카테고리/태그/담당자/중요도 | ✅ | 관리 UI는 없음 (5-3) |
| 참고 링크 다중 | ✅ | |
| 체크리스트 (회차마다 초기화) | ✅ | |
| 매년/매분기/매월/매주/격주/N일 | ✅ | 9종 |
| N번째 요일 | ✅ | 5번째 없는 달 처리 옵션 포함 |
| 특정 월 복수 지정 | ✅ | |
| 시작일/종료일/총 횟수 제한 | ✅ | |
| 1회성 예외 (변경/건너뛰기) | ✅ | UI는 회차 상세에서 |
| Asia/Seoul 고정 | ✅ | TZ 테스트로 검증 |
| 공휴일 3정책 | ✅ | + 이동 대상 3종 |
| 공휴일 데이터 분리 | ✅ | 2024~2028 |
| 선행/후행 다중 | ✅ | |
| 순환 참조 차단 + 명확한 에러 | ✅ | 경로를 업무 제목으로 표시 |
| blocked 상태 | ✅ | 파생 상태로 계산 |
| 의존 오프셋(lag) | ✅ | 영업일/달력일 |
| 선행 지연 영향 경고 | ✅ | 대시보드·상세 양쪽 |
| 의존 그래프 시각화 | ✅ | 인라인 SVG |
| 알림 시점 복수 | ✅ | 영업일 오프셋도 지원 |
| 지연 리마인더 반복 | ✅ | 폭주 방지 로직 포함 |
| 선행 완료 시 후행 알림 | ✅ | 실제 발송 검증 완료 |
| cron + 재시작 후 재개 | ✅ | 실제 복구 기록 확인 |
| 채널 어댑터 추상화 | ✅ | 브라우저 + 이메일 |
| 발송 이력 + 중복 방지 | ✅ | dedupeKey 유니크 |
| 연간 대시보드 | ✅ | |
| 월간 뷰 (캘린더/리스트) | ✅ | |
| 업무 상세 | ✅ | |
| 다음 10회 미리보기 | ✅ | 실시간, 서버 계산 |
| 필터 5종 | ✅ | URL 보관 |
| 모든 주석·UI 한국어 | ✅ | |
| 날짜 로직 순수 함수 + 테스트 | ✅ | 248개 |
| DECISIONS.md | ✅ | 26개 항목 |
| `npm install && npm run dev` | ✅ | + `npm run setup` (DB 초기화) |
