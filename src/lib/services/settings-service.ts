/**
 * 전역 설정 서비스 (AppSetting 키-값 저장소)
 */

import { prisma } from "@/lib/db";

export const SETTING_KEYS = {
  /** Occurrence 를 미리 생성해 둘 개월 수 */
  rollingWindowMonths: "rollingWindowMonths",
  /** 로그인 기능이 없는 동안 "나"로 취급할 사용자 ID */
  currentUserId: "currentUserId",
  /** 이 시간 이상 지난 알림은 발송하지 않고 폐기 */
  staleNotificationHours: "staleNotificationHours",
  /** 마지막 Occurrence 생성 배치 실행 시각 (ISO 문자열) */
  lastGenerationRunAt: "lastGenerationRunAt",
  /** 마지막 알림 스케줄러 실행 시각 (ISO 문자열) */
  lastSchedulerRunAt: "lastSchedulerRunAt",
} as const;

export const SETTING_DEFAULTS = {
  rollingWindowMonths: 18,
  staleNotificationHours: 48,
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const raw = await getSetting(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Occurrence 를 미리 생성해 둘 개월 수 (기본 18) */
export async function getRollingWindowMonths(): Promise<number> {
  return getNumberSetting(
    SETTING_KEYS.rollingWindowMonths,
    SETTING_DEFAULTS.rollingWindowMonths,
  );
}

/** 낡은 알림 폐기 기준 시간 (기본 48시간) */
export async function getStaleNotificationHours(): Promise<number> {
  return getNumberSetting(
    SETTING_KEYS.staleNotificationHours,
    SETTING_DEFAULTS.staleNotificationHours,
  );
}

/**
 * "현재 사용자". 로그인 기능이 없으므로 설정값 → 없으면 첫 활성 사용자로 폴백한다.
 * 추후 인증을 붙이면 이 함수만 세션 기반으로 교체하면 된다.
 */
export async function getCurrentUser() {
  const configuredId = await getSetting(SETTING_KEYS.currentUserId);

  if (configuredId) {
    const user = await prisma.user.findUnique({ where: { id: configuredId } });
    if (user) return user;
  }

  return prisma.user.findFirst({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
}

export async function setCurrentUser(userId: string): Promise<void> {
  await setSetting(SETTING_KEYS.currentUserId, userId);
}

export async function recordRunTimestamp(key: string, at: Date = new Date()) {
  await setSetting(key, at.toISOString());
}
