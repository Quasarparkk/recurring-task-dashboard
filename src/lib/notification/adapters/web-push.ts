/**
 * 웹 브라우저 알림 어댑터
 * ============================================================================
 *
 * [구현 방식] Web Push Protocol(VAPID + Service Worker)을 쓰지 않고,
 * **알림 이력 테이블을 받은편지함으로 사용하는 폴링 방식**을 택했다.
 *
 * 이유:
 *   - Web Push 는 VAPID 키 생성, Service Worker 등록, 구독 정보 저장이 필요하다.
 *     `npm install && npm run dev` 만으로 동작해야 한다는 요구사항과 맞지 않는다.
 *   - 사내 로컬 사용 환경에서는 브라우저가 열려 있을 때만 알림이 필요하다.
 *   - 이 어댑터는 "발송"으로서 로그 행만 남기고, 클라이언트가
 *     `/api/notifications/unread` 를 주기적으로 조회해 브라우저 Notification API 로
 *     실제 알림을 띄운다. (src/components/notification-watcher.tsx)
 *
 * 즉 발송 성공 = 로그 저장 성공이다. 실제 저장은 dispatcher 가 수행하므로
 * 이 어댑터는 항상 성공을 반환한다.
 *
 * 추후 진짜 Web Push 가 필요해지면 이 파일만 교체하면 된다.
 */

import type { NotificationChannelAdapter, SendResult } from "../types";

export const webPushAdapter: NotificationChannelAdapter = {
  id: "WEB_PUSH",
  label: "브라우저 알림",
  description: "대시보드가 열려 있을 때 브라우저 알림으로 표시합니다.",

  isAvailable() {
    // 브라우저 알림은 수신자 정보가 없어도(담당자 미지정) 표시할 수 있다.
    return { ok: true };
  },

  async send(): Promise<SendResult> {
    // 실제 전달은 클라이언트 폴링이 담당한다.
    // dispatcher 가 NotificationLog 행을 저장하는 것으로 발송이 완료된다.
    return { ok: true, detail: "알림 목록에 등록됨 (클라이언트 폴링 대기)" };
  },
};
