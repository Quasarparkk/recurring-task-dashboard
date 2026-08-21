"use client";

/**
 * 의존 관계 그래프 시각화 (인라인 SVG)
 * ============================================================================
 *
 * 외부 그래프 라이브러리(React Flow, d3 등)를 쓰지 않은 이유:
 *   - 사내 업무의 의존 그래프는 보통 노드 3~10개 규모다. 이 크기에서는
 *     계층형 레이아웃(longest-path layering)을 직접 계산하는 것이
 *     라이브러리 도입보다 코드가 짧고 번들도 가볍다.
 *   - 레이아웃 계산은 이미 순수 함수로 테스트되어 있다
 *     (src/lib/dependency/graph.ts 의 computeLayeredLayout).
 *
 * 레이아웃: 왼쪽 → 오른쪽. 레이어 0 = 선행이 없는 업무.
 */

import Link from "next/link";
import { useMemo } from "react";

import { computeLayeredLayout, type DependencyEdge } from "@/lib/dependency/graph";
import { LAG_UNIT_LABELS } from "@/lib/validation/task-schema";
import { cn } from "@/lib/utils";

export interface GraphNode {
  id: string;
  title: string;
  /** 현재 화면의 주인공 업무 */
  isFocus: boolean;
  /** 미완료 회차 중 지연된 건이 있는지 */
  hasOverdue: boolean;
  /** 선행 대기 중인 회차가 있는지 */
  hasBlocked: boolean;
  isActive: boolean;
}

export interface GraphEdge extends DependencyEdge {
  id: string;
  lagAmount: number;
  lagUnit: "BUSINESS_DAY" | "CALENDAR_DAY";
  isBlocking: boolean;
}

// --- 레이아웃 상수 ---
const NODE_WIDTH = 170;
const NODE_HEIGHT = 52;
const LAYER_GAP = 76;
const ROW_GAP = 18;
const PADDING = 16;

export function DependencyGraph({
  nodes,
  edges,
  className,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  className?: string;
}) {
  const layout = useMemo(
    () =>
      computeLayeredLayout(
        nodes.map((node) => node.id),
        edges,
      ),
    [nodes, edges],
  );

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of layout.nodes) {
      map.set(node.id, {
        x: PADDING + node.layer * (NODE_WIDTH + LAYER_GAP),
        y: PADDING + node.indexInLayer * (NODE_HEIGHT + ROW_GAP),
      });
    }
    return map;
  }, [layout]);

  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  if (nodes.length <= 1) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        등록된 선행/후행 업무가 없습니다.
      </div>
    );
  }

  const width = PADDING * 2 + layout.layerCount * NODE_WIDTH + (layout.layerCount - 1) * LAYER_GAP;
  const height = PADDING * 2 + layout.maxLayerSize * NODE_HEIGHT + (layout.maxLayerSize - 1) * ROW_GAP;

  return (
    <div className={cn("overflow-x-auto rounded-lg border bg-card p-1", className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-full"
        role="img"
        aria-label="업무 의존 관계 그래프"
      >
        <defs>
          {/* 차단 관계용 화살표 */}
          <marker
            id="arrow-blocking"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
          </marker>
          {/* 참고용 관계 (차단하지 않음) */}
          <marker
            id="arrow-reference"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground/50" />
          </marker>
        </defs>

        {/* ---------- 간선 ---------- */}
        {edges.map((edge) => {
          const from = positions.get(edge.predecessorId);
          const to = positions.get(edge.successorId);
          if (!from || !to) return null;

          const x1 = from.x + NODE_WIDTH;
          const y1 = from.y + NODE_HEIGHT / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_HEIGHT / 2;

          // 베지어 곡선: 수평 방향으로 부드럽게 이어지도록 제어점을 중간에 둔다.
          const controlOffset = Math.max(30, (x2 - x1) / 2);
          const path = `M ${x1} ${y1} C ${x1 + controlOffset} ${y1}, ${x2 - controlOffset} ${y2}, ${x2} ${y2}`;

          const labelX = (x1 + x2) / 2;
          const labelY = (y1 + y2) / 2 - 6;
          const hasLag = edge.lagAmount > 0;

          return (
            <g key={edge.id}>
              <path
                d={path}
                fill="none"
                className={cn(
                  edge.isBlocking
                    ? "stroke-muted-foreground"
                    : "stroke-muted-foreground/40",
                )}
                strokeWidth={edge.isBlocking ? 1.5 : 1.2}
                strokeDasharray={edge.isBlocking ? undefined : "4 3"}
                markerEnd={
                  edge.isBlocking ? "url(#arrow-blocking)" : "url(#arrow-reference)"
                }
              />

              {hasLag && (
                <>
                  <rect
                    x={labelX - 26}
                    y={labelY - 9}
                    width={52}
                    height={16}
                    rx={8}
                    className="fill-card stroke-border"
                    strokeWidth={1}
                  />
                  <text
                    x={labelX}
                    y={labelY + 2}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[9px]"
                  >
                    +{edge.lagAmount}
                    {edge.lagUnit === "BUSINESS_DAY" ? "영업일" : "일"}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* ---------- 노드 ---------- */}
        {layout.nodes.map((layoutNode) => {
          const node = nodeById.get(layoutNode.id);
          const position = positions.get(layoutNode.id);
          if (!node || !position) return null;

          return (
            <GraphNodeBox
              key={node.id}
              node={node}
              x={position.x}
              y={position.y}
            />
          );
        })}
      </svg>
    </div>
  );
}

function GraphNodeBox({
  node,
  x,
  y,
}: {
  node: GraphNode;
  x: number;
  y: number;
}) {
  const strokeClass = node.isFocus
    ? "stroke-primary"
    : node.hasOverdue
      ? "stroke-status-overdue-line"
      : node.hasBlocked
        ? "stroke-status-blocked-line"
        : "stroke-border";

  const fillClass = node.isFocus
    ? "fill-primary/10"
    : node.hasOverdue
      ? "fill-status-overdue-bg"
      : node.hasBlocked
        ? "fill-status-blocked-bg"
        : "fill-card";

  // 제목을 두 줄로 자른다 (SVG 는 자동 줄바꿈이 없다).
  const maxCharsPerLine = 13;
  const line1 = node.title.slice(0, maxCharsPerLine);
  const rest = node.title.slice(maxCharsPerLine);
  const line2 =
    rest.length > maxCharsPerLine ? `${rest.slice(0, maxCharsPerLine - 1)}…` : rest;

  return (
    <g>
      <Link href={`/tasks/${node.id}`}>
        <rect
          x={x}
          y={y}
          width={NODE_WIDTH}
          height={NODE_HEIGHT}
          rx={8}
          className={cn(fillClass, strokeClass, "cursor-pointer hover:brightness-95")}
          strokeWidth={node.isFocus ? 2 : 1.2}
        />

        <text
          x={x + 10}
          y={y + (line2 ? 20 : 26)}
          className={cn(
            "pointer-events-none text-[11px]",
            node.isFocus ? "fill-foreground font-semibold" : "fill-foreground",
          )}
        >
          {line1}
        </text>
        {line2 && (
          <text
            x={x + 10}
            y={y + 34}
            className="pointer-events-none fill-foreground text-[11px]"
          >
            {line2}
          </text>
        )}

        {/* 상태 표시 점 */}
        {(node.hasOverdue || node.hasBlocked) && (
          <circle
            cx={x + NODE_WIDTH - 10}
            cy={y + 10}
            r={4}
            className={
              node.hasOverdue
                ? "fill-status-overdue-line"
                : "fill-status-blocked-line"
            }
          />
        )}

        {!node.isActive && (
          <text
            x={x + NODE_WIDTH - 10}
            y={y + NODE_HEIGHT - 8}
            textAnchor="end"
            className="pointer-events-none fill-muted-foreground text-[9px]"
          >
            보관
          </text>
        )}
      </Link>
    </g>
  );
}

/** 그래프 범례 */
export function DependencyGraphLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <svg width="26" height="8" aria-hidden>
          <line
            x1="0"
            y1="4"
            x2="26"
            y2="4"
            className="stroke-muted-foreground"
            strokeWidth="1.5"
          />
        </svg>
        차단 관계 (선행 미완료 시 대기)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="26" height="8" aria-hidden>
          <line
            x1="0"
            y1="4"
            x2="26"
            y2="4"
            className="stroke-muted-foreground/50"
            strokeWidth="1.2"
            strokeDasharray="4 3"
          />
        </svg>
        참고용 연결 (상태에 영향 없음)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded-full border border-border bg-card px-1.5 text-[9px]">
          +N{LAG_UNIT_LABELS.BUSINESS_DAY}
        </span>
        선행 완료 후 지연(lag)
      </span>
    </div>
  );
}
