import Link from "next/link";
import { FileQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <FileQuestion className="size-10 text-muted-foreground" />
      <h1 className="mt-4 text-lg font-semibold">페이지를 찾을 수 없습니다</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        요청한 업무가 삭제되었거나 주소가 잘못되었을 수 있습니다.
      </p>
      <div className="mt-5 flex gap-2">
        <Button asChild>
          <Link href="/">연간 대시보드로</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/tasks">업무 목록</Link>
        </Button>
      </div>
    </div>
  );
}
