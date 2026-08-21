/**
 * Next.js instrumentation — 서버 부팅 훅
 * ============================================================================
 *
 * Next.js 는 서버 프로세스가 시작될 때 이 파일의 `register()` 를 한 번 호출한다.
 * 여기서 알림 스케줄러를 시작하면 별도의 워커 프로세스 없이
 * `npm run dev` 만으로 백엔드 스케줄러가 동작한다.
 *
 * 주의: Edge 런타임에서도 호출되므로 Node.js 런타임인지 반드시 확인해야 한다.
 * (node-cron, Prisma 는 Edge 에서 동작하지 않는다)
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // 빌드 단계(next build)에서는 스케줄러를 띄우지 않는다.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    const { startScheduler } = await import("@/lib/notification/scheduler");
    await startScheduler();
  } catch (error) {
    // 스케줄러 실패가 앱 부팅 자체를 막지 않도록 한다.
    // (예: DB 가 아직 마이그레이션되지 않은 상태)
    console.error(
      "[instrumentation] 스케줄러를 시작하지 못했습니다. 앱은 정상 동작합니다.",
      error,
    );
  }
}
