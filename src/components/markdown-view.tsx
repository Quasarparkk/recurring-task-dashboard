/**
 * Markdown 렌더러
 * ============================================================================
 * 업무 상세 설명을 표시한다. GFM(표, 체크박스, 취소선)을 지원한다.
 *
 * 보안: react-markdown 은 기본적으로 HTML 을 렌더링하지 않는다
 * (rehype-raw 를 쓰지 않음). 따라서 사용자가 입력한 <script> 등은
 * 그대로 텍스트로 표시되며 XSS 위험이 없다.
 */

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

export function MarkdownView({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={cn("text-sm leading-relaxed", className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-2 mt-5 border-b pb-1 text-lg font-semibold first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-5 text-base font-semibold first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1.5 mt-4 text-sm font-semibold first:mt-0">{children}</h3>
          ),
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-status-blocked-line/60 bg-status-blocked-bg/30 py-1 pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          code: ({ children, className: codeClassName }) => {
            // 코드 블록(```)은 className 이 붙고, 인라인 코드는 붙지 않는다.
            const isBlock = Boolean(codeClassName);
            if (isBlock) {
              return (
                <code className="block overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="my-3">{children}</pre>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-status-progress-fg underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-4 border-border" />,
          // --- 표 (GFM) ---
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-md border">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b px-2.5 py-1.5 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-b px-2.5 py-1.5 align-top last:border-b-0">
              {children}
            </td>
          ),
          // --- 체크박스 (GFM task list) ---
          input: ({ checked, type }) =>
            type === "checkbox" ? (
              <input
                type="checkbox"
                checked={checked}
                readOnly
                className="mr-1.5 align-middle accent-current"
              />
            ) : null,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
