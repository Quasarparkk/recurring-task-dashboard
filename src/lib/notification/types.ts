/**
 * 알림 채널 어댑터 인터페이스
 * ============================================================================
 *
 * [어댑터 패턴을 쓰는 이유]
 * 스케줄러·중복방지·이력 저장 로직은 "어떤 채널로 보내는가"를 몰라야 한다.
 * 그래야 Slack/Teams 를 추가할 때 어댑터 파일 하나를 작성하고
 * 레지스트리에 한 줄 등록하는 것으로 끝난다.
 *
 * 새 채널 추가 절차:
 *   1. `adapters/<채널>.ts` 에 NotificationChannelAdapter 구현
 *   2. `registry.ts` 의 ADAPTERS 배열에 추가
 *   3. (끝) — 스케줄러·API·UI 는 수정하지 않는다
 */

import type { PlainDate } from "@/lib/date/plain-date";

/** 채널 식별자. 레지스트리에 등록된 값만 사용 가능하다. */
export type ChannelId = string;

export interface NotificationRecipient {
  id: string | null;
  name: string;
  email: string | null;
}

/** 발송할 알림의 내용. 채널에 종속되지 않는 형태로 표현한다. */
export interface NotificationPayload {
  /** 알림 종류 */
  kind: "SCHEDULED" | "OVERDUE_REMINDER" | "DEPENDENCY_UNBLOCKED";

  title: string;
  /** 본문 (평문). 채널별로 마크업을 붙이는 것은 어댑터의 책임이다. */
  body: string;

  recipient: NotificationRecipient;

  /** 관련 업무 정보 (링크 생성 및 본문 구성에 사용) */
  task: {
    id: string;
    title: string;
    priority: string;
  };
  occurrence: {
    id: string;
    scheduledDate: PlainDate;
    /** 마감일까지 남은 일수. 음수면 초과. */
    daysUntilDue: number;
  };

  /** 대시보드 상세 화면 경로 (절대 URL 이 아닌 앱 내부 경로) */
  linkPath: string;
}

export interface SendResult {
  ok: boolean;
  /** 실패 시 사람이 읽을 수 있는 이유 */
  error?: string;
  /** 채널이 반환한 식별자 등 부가 정보 (로그용) */
  detail?: string;
}

export interface NotificationChannelAdapter {
  /** DB 에 저장되는 채널 식별자. 변경하면 기존 이력과 어긋나므로 고정한다. */
  readonly id: ChannelId;
  /** UI 에 표시할 이름 */
  readonly label: string;
  /** 사용자에게 보여줄 짧은 설명 */
  readonly description: string;

  /**
   * 이 채널을 현재 환경에서 쓸 수 있는지.
   * 예: 이메일은 수신자 주소가 필요하고, Slack 은 토큰이 필요하다.
   * false 를 반환하면 스케줄러가 발송을 건너뛰고 그 이유를 로그에 남긴다.
   */
  isAvailable(payload: NotificationPayload): { ok: true } | { ok: false; reason: string };

  send(payload: NotificationPayload): Promise<SendResult>;
}
