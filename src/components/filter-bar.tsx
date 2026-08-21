"use client";

/**
 * 필터 바 — 담당자 / 카테고리 / 태그 / 상태 / 중요도 / 검색
 *
 * 필터 상태는 URL 쿼리스트링에 보관한다. 그래야 새로고침·뒤로가기·링크 공유가
 * 모두 자연스럽게 동작하고, 서버 컴포넌트가 그 값으로 바로 조회할 수 있다.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_LABEL, STATUS_ORDER } from "@/lib/ui/status-style";
import { PRIORITY_LABELS } from "@/lib/validation/task-schema";

export interface FilterOptions {
  users: { id: string; name: string; department: string | null }[];
  categories: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

/** Select 의 "전체" 항목 값. 빈 문자열은 Radix Select 가 허용하지 않는다. */
const ALL = "__all__";

export function FilterBar({ options }: { options: FilterOptions }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  const current = useMemo(
    () => ({
      assigneeId: searchParams.get("assigneeId") ?? ALL,
      categoryId: searchParams.get("categoryId") ?? ALL,
      tagId: searchParams.get("tagId") ?? ALL,
      status: searchParams.get("status") ?? ALL,
      priority: searchParams.get("priority") ?? ALL,
    }),
    [searchParams],
  );

  const activeCount = Object.values(current).filter((v) => v !== ALL).length +
    (searchParams.get("q") ? 1 : 0);

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === ALL || value === "") params.delete(key);
      else params.set(key, value);

      startTransition(() => {
        router.replace(`?${params.toString()}`, { scroll: false });
      });
    },
    [router, searchParams],
  );

  const clearAll = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ["assigneeId", "categoryId", "tagId", "status", "priority", "q"]) {
      params.delete(key);
    }
    setQuery("");
    startTransition(() => {
      router.replace(`?${params.toString()}`, { scroll: false });
    });
  }, [router, searchParams]);

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-pending={isPending ? "" : undefined}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          update("q", query.trim());
        }}
        className="relative"
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="업무명 검색"
          className="h-8 w-40 pl-8 text-sm"
        />
      </form>

      <FilterSelect
        value={current.assigneeId}
        onValueChange={(value) => update("assigneeId", value)}
        placeholder="담당자"
        items={options.users.map((user) => ({
          value: user.id,
          label: user.department ? `${user.name} · ${user.department}` : user.name,
        }))}
      />

      <FilterSelect
        value={current.categoryId}
        onValueChange={(value) => update("categoryId", value)}
        placeholder="카테고리"
        items={options.categories.map((c) => ({ value: c.id, label: c.name }))}
      />

      <FilterSelect
        value={current.tagId}
        onValueChange={(value) => update("tagId", value)}
        placeholder="태그"
        items={options.tags.map((t) => ({ value: t.id, label: `#${t.name}` }))}
      />

      <FilterSelect
        value={current.status}
        onValueChange={(value) => update("status", value)}
        placeholder="상태"
        items={STATUS_ORDER.map((status) => ({
          value: status,
          label: STATUS_LABEL[status],
        }))}
      />

      <FilterSelect
        value={current.priority}
        onValueChange={(value) => update("priority", value)}
        placeholder="중요도"
        items={(["HIGH", "MEDIUM", "LOW"] as const).map((priority) => ({
          value: priority,
          label: PRIORITY_LABELS[priority],
        }))}
      />

      {activeCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAll}
          className="h-8 text-muted-foreground"
        >
          <X className="size-3.5" />
          필터 해제 ({activeCount})
        </Button>
      )}
    </div>
  );
}

function FilterSelect({
  value,
  onValueChange,
  placeholder,
  items,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  items: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="sm"
        className="h-8 w-auto min-w-[7rem] gap-1 text-sm data-[state=open]:bg-accent"
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder} 전체</SelectItem>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
