"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, LayoutGrid, ListChecks, Plus, Settings } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/", label: "연간 대시보드", icon: LayoutGrid, exact: true },
  { href: "/month", label: "월간 뷰", icon: CalendarDays, exact: false },
  { href: "/tasks", label: "업무 목록", icon: ListChecks, exact: true },
  { href: "/settings", label: "설정", icon: Settings, exact: false },
] as const;

export function AppHeader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 연도 컨텍스트를 유지하며 이동하도록 쿼리를 이어 붙인다.
  const year = searchParams.get("year");
  const suffix = year ? `?year=${year}` : "";

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-6 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground">
            정
          </span>
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">
            정기 업무 관리
          </span>
        </Link>

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={`${item.href}${item.href === "/settings" ? "" : suffix}`}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <item.icon className="size-4" />
                <span className="hidden md:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <Button asChild size="sm" className="shrink-0">
          <Link href="/tasks/new">
            <Plus className="size-4" />
            <span className="hidden sm:inline">업무 등록</span>
          </Link>
        </Button>
      </div>
    </header>
  );
}
