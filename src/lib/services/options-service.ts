/**
 * 필터·폼용 선택 옵션 조회
 */

import { prisma } from "@/lib/db";

export async function loadFilterOptions() {
  const [users, categories, tags] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, department: true },
      orderBy: [{ department: "asc" }, { name: "asc" }],
    }),
    prisma.category.findMany({
      select: { id: true, name: true, color: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.tag.findMany({
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return { users, categories, tags };
}
