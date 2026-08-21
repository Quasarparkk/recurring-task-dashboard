/**
 * Prisma 클라이언트 싱글턴
 * ============================================================================
 *
 * Next.js 개발 모드는 파일 변경 시 모듈을 다시 평가한다. 매번 새 PrismaClient 를
 * 만들면 커넥션이 누적되어 결국 "too many connections" 로 죽는다.
 * globalThis 에 캐시해 HMR 사이에서 인스턴스를 재사용한다.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
