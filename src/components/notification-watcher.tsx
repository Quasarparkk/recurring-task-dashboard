"use client";

/**
 * 브라우저 알림 감시자 — WEB_PUSH 어댑터의 클라이언트 측
 * ============================================================================
 *
 * 서버의 WEB_PUSH 어댑터는 NotificationLog 에 행을 남기는 것으로 "발송"을 끝낸다.
 * 실제로 사용자에게 알림을 띄우는 것은 이 컴포넌트다.
 *
 * 동작:
 *   1. 30초마다 `/api/notifications/unread` 를 조회한다.
 *   2. 새 알림이 있으면 브라우저 Notification API 로 표시한다.
 *   3. 권한이 없거나 거부된 경우 화면 내 토스트로 대체한다.
 *   4. 표시한 알림은 읽음 처리해 중복 표시를 막는다.
 *
 * Web Push Protocol(VAPID + Service Worker)을 쓰지 않은 이유는
 * DECISIONS.md 및 adapters/web-push.ts 주석 참고.
 *
 * [구현 메모] 알림 권한은 React 상태가 아니라 **브라우저가 소유한 외부 상태**다.
 * 그래서 useState + useEffect 로 복제하지 않고 `useSyncExternalStore` 로 읽는다.
 * (effect 안에서 setState 하면 불필요한 연쇄 렌더가 발생한다)
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";

const POLL_INTERVAL_MS = 30_000;

interface UnreadNotification {
  id: string;
  title: string;
  body: string;
  kind: string;
  taskId: string;
  occurrenceId: string;
  plannedAt: string;
}

// ---------------------------------------------------------------------------
// 알림 권한 외부 스토어
// ---------------------------------------------------------------------------

type PermissionState = NotificationPermission | "unsupported" | "dismissed";

const listeners = new Set<() => void>();

/** 사용자가 배너를 닫았는지 (세션 한정) */
let bannerDismissed = false;

function emitChange(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  if (bannerDismissed && Notification.permission === "default") return "dismissed";
  return Notification.permission;
}

/** 서버 렌더링 시점에는 배너를 그리지 않는다 (하이드레이션 불일치 방지). */
function getServerSnapshot(): PermissionState {
  return "unsupported";
}

function requestPermission(): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  void Notification.requestPermission().then(() => emitChange());
}

function dismissBanner(): void {
  bannerDismissed = true;
  emitChange();
}

// ---------------------------------------------------------------------------
// 컴포넌트
// ---------------------------------------------------------------------------

export function NotificationWatcher() {
  const router = useRouter();
  const permission = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /** 이미 표시한 알림 ID (같은 세션 내 중복 표시 방지) */
  const shownIds = useRef<Set<string>>(new Set());

  const openOccurrence = useCallback(
    (taskId: string, occurrenceId: string) => {
      router.push(`/tasks/${taskId}?occurrence=${occurrenceId}`);
    },
    [router],
  );

  const showNotification = useCallback(
    (item: UnreadNotification) => {
      const canUseBrowser =
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted";

      if (canUseBrowser) {
        try {
          const notification = new Notification(item.title, {
            body: item.body,
            tag: item.id,
          });

          notification.onclick = () => {
            window.focus();
            openOccurrence(item.taskId, item.occurrenceId);
            notification.close();
          };
          return;
        } catch {
          // 브라우저 알림 생성 실패 시 토스트로 폴백한다.
        }
      }

      toast(item.title, {
        description: item.body,
        duration: 10_000,
        action: {
          label: "열기",
          onClick: () => openOccurrence(item.taskId, item.occurrenceId),
        },
      });
    },
    [openOccurrence],
  );

  useEffect(() => {
    if (permission === "unsupported") return;

    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch("/api/notifications/unread", {
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;

        const data = (await response.json()) as { notifications: UnreadNotification[] };
        const fresh = data.notifications.filter((n) => !shownIds.current.has(n.id));
        if (fresh.length === 0) return;

        for (const item of fresh) {
          shownIds.current.add(item.id);
          showNotification(item);
        }

        // 읽음 처리 (서버가 다시 내려주지 않도록)
        void fetch("/api/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: fresh.map((n) => n.id) }),
        });
      } catch {
        // 네트워크 오류는 조용히 무시하고 다음 폴링을 기다린다.
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [permission, showNotification]);

  // 권한을 아직 묻지 않았을 때만 안내 배너를 띄운다.
  if (permission !== "default") return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-xs rounded-lg border bg-card p-3 shadow-lg">
      <p className="text-sm font-medium">브라우저 알림 허용</p>
      <p className="mt-1 text-xs text-muted-foreground">
        마감 임박·지연 업무를 브라우저 알림으로 받으려면 권한이 필요합니다. 허용하지
        않아도 화면 내 알림으로 표시됩니다.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={requestPermission}
          className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
        >
          허용
        </button>
        <button
          type="button"
          onClick={dismissBanner}
          className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
        >
          나중에
        </button>
      </div>
    </div>
  );
}
