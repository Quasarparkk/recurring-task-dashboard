/**
 * Prisma 설정 파일
 * ============================================================================
 * Prisma 7 부터 `package.json#prisma` 필드가 제거되므로 미리 이 파일로 옮겼다.
 * (6.x 에서 package.json 방식을 쓰면 명령마다 deprecation 경고가 출력된다)
 *
 * ⚠️ 중요: 설정 파일이 존재하면 Prisma CLI 는 **.env 를 자동으로 읽지 않는다**
 *          ("Prisma config detected, skipping environment variable loading").
 *          따라서 DATABASE_URL 을 여기서 직접 로드해야 `prisma db push` 가 동작한다.
 *          이걸 빼먹으면 신규 사용자가 실행하는 첫 명령이 바로 실패한다.
 *
 * 로드 순서는 Next.js 관례를 따른다: `.env.local` 이 `.env` 를 덮어쓴다.
 * (process.loadEnvFile 은 이미 설정된 값을 덮어쓰지 않으므로 .env.local 을 먼저 읽는다)
 */

import path from "node:path";

import type { PrismaConfig } from "prisma";

/** 파일이 없으면 조용히 넘어간다. */
function loadEnvFileIfExists(filePath: string): void {
  try {
    process.loadEnvFile(filePath);
  } catch {
    // 파일이 없거나 읽을 수 없는 경우 — 환경변수가 이미 주입되었을 수 있으므로 무시한다.
  }
}

loadEnvFileIfExists(".env.local");
loadEnvFileIfExists(".env");

export default {
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
} satisfies PrismaConfig;
