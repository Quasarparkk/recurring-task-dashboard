/**
 * 알림 채널 레지스트리
 * ============================================================================
 * 새 채널을 추가할 때 수정하는 유일한 파일이다.
 *
 * Slack 을 추가하는 예:
 *   1. adapters/slack.ts 에 slackAdapter 작성
 *   2. 아래 ADAPTERS 배열에 slackAdapter 추가
 *   3. 끝. 스케줄러·API·UI 는 손대지 않는다.
 */

import { emailAdapter } from "./adapters/email";
import { webPushAdapter } from "./adapters/web-push";
import type { ChannelId, NotificationChannelAdapter } from "./types";

/** 등록된 어댑터 목록. 순서가 UI 표시 순서가 된다. */
const ADAPTERS: readonly NotificationChannelAdapter[] = [
  webPushAdapter,
  emailAdapter,
  // 예정: slackAdapter, teamsAdapter
];

const BY_ID = new Map<ChannelId, NotificationChannelAdapter>(
  ADAPTERS.map((adapter) => [adapter.id, adapter]),
);

export function getAdapter(channelId: ChannelId): NotificationChannelAdapter | null {
  return BY_ID.get(channelId) ?? null;
}

export function listAdapters(): readonly NotificationChannelAdapter[] {
  return ADAPTERS;
}

/** UI 용 채널 목록 (직렬화 가능한 형태) */
export function listChannelOptions(): {
  id: ChannelId;
  label: string;
  description: string;
}[] {
  return ADAPTERS.map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    description: adapter.description,
  }));
}

/** 등록되지 않은 채널 ID 를 걸러낸다. 저장된 이력의 채널이 사라진 경우 등에 사용. */
export function filterKnownChannels(channelIds: readonly string[]): ChannelId[] {
  return channelIds.filter((id) => BY_ID.has(id));
}

export const DEFAULT_CHANNELS: ChannelId[] = [webPushAdapter.id];

/** `NotificationRule.channels` JSON 문자열을 안전하게 파싱한다. */
export function parseChannels(raw: string): ChannelId[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_CHANNELS;
    const known = filterKnownChannels(parsed.filter((v) => typeof v === "string"));
    return known.length > 0 ? known : DEFAULT_CHANNELS;
  } catch {
    return DEFAULT_CHANNELS;
  }
}
