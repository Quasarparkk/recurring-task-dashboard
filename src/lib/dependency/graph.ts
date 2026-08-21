/**
 * 의존관계 그래프 (DAG) — 순환 검증 / 위상 정렬 / 레이아웃
 * ============================================================================
 *
 * 순수 함수 모듈이다. Prisma 타입에 의존하지 않고 `{ predecessorId, successorId }`
 * 형태의 간선 배열만 받는다. 덕분에 단위 테스트가 DB 없이 가능하다.
 *
 * 모든 순회 함수는 방문 집합(visited set)을 두어, 데이터가 어떤 이유로든
 * 순환을 갖게 되더라도 무한 루프에 빠지지 않는다.
 * (등록 시점에 순환을 차단하지만, 읽기 경로도 방어적으로 작성한다)
 */

export interface DependencyEdge {
  predecessorId: string;
  successorId: string;
}

// ---------------------------------------------------------------------------
// 인접 리스트
// ---------------------------------------------------------------------------

export interface AdjacencyMaps {
  /** 노드 → 후행 노드 목록 */
  successors: Map<string, string[]>;
  /** 노드 → 선행 노드 목록 */
  predecessors: Map<string, string[]>;
  /** 간선에 등장하는 모든 노드 */
  nodes: Set<string>;
}

export function buildAdjacency(edges: readonly DependencyEdge[]): AdjacencyMaps {
  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  const nodes = new Set<string>();

  for (const { predecessorId, successorId } of edges) {
    nodes.add(predecessorId);
    nodes.add(successorId);

    const succList = successors.get(predecessorId);
    if (succList) succList.push(successorId);
    else successors.set(predecessorId, [successorId]);

    const predList = predecessors.get(successorId);
    if (predList) predList.push(predecessorId);
    else predecessors.set(successorId, [predecessorId]);
  }

  return { successors, predecessors, nodes };
}

// ---------------------------------------------------------------------------
// 순환 탐지
// ---------------------------------------------------------------------------

/**
 * 그래프 전체에서 순환을 찾는다.
 *
 * @returns 순환 경로 (예: `["A","B","C","A"]`). 순환이 없으면 null.
 */
export function findCycle(edges: readonly DependencyEdge[]): string[] | null {
  const { successors, nodes } = buildAdjacency(edges);

  // 0 = 미방문, 1 = 현재 탐색 경로에 있음, 2 = 탐색 완료
  const state = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];

  function dfs(node: string): string[] | null {
    state.set(node, 1);
    path.push(node);

    for (const next of successors.get(node) ?? []) {
      const nextState = state.get(next) ?? 0;

      if (nextState === 1) {
        // 현재 경로에 이미 있는 노드 → 순환. 경로를 잘라서 반환한다.
        const start = path.indexOf(next);
        return [...path.slice(start), next];
      }
      if (nextState === 0) {
        const cycle = dfs(next);
        if (cycle) return cycle;
      }
    }

    path.pop();
    state.set(node, 2);
    return null;
  }

  for (const node of nodes) {
    if ((state.get(node) ?? 0) === 0) {
      const cycle = dfs(node);
      if (cycle) return cycle;
    }
  }

  return null;
}

/**
 * 기존 간선에 새 간선을 추가했을 때 순환이 생기는지 검사한다.
 *
 * @returns 순환이 생기면 그 경로, 아니면 null
 */
export function wouldCreateCycle(
  existingEdges: readonly DependencyEdge[],
  newEdge: DependencyEdge,
): string[] | null {
  // 자기 자신을 선행으로 두는 경우
  if (newEdge.predecessorId === newEdge.successorId) {
    return [newEdge.predecessorId, newEdge.successorId];
  }

  // 이미 존재하는 간선이면 그래프가 변하지 않는다.
  const alreadyExists = existingEdges.some(
    (e) =>
      e.predecessorId === newEdge.predecessorId && e.successorId === newEdge.successorId,
  );
  if (alreadyExists) return null;

  return findCycle([...existingEdges, newEdge]);
}

/**
 * 순환이 생기면 경로를 담은 에러를 던진다.
 *
 * @param resolveLabel 노드 ID → 사람이 읽을 이름(업무 제목). 에러 메시지에 사용.
 */
export function assertNoCycle(
  existingEdges: readonly DependencyEdge[],
  newEdge: DependencyEdge,
  resolveLabel: (id: string) => string = (id) => id,
): void {
  const cycle = wouldCreateCycle(existingEdges, newEdge);
  if (!cycle) return;

  if (newEdge.predecessorId === newEdge.successorId) {
    throw new DependencyCycleError(
      `"${resolveLabel(newEdge.predecessorId)}" 업무를 자기 자신의 선행 업무로 지정할 수 없습니다.`,
      cycle,
    );
  }

  const pathText = cycle.map(resolveLabel).join(" → ");
  throw new DependencyCycleError(
    `순환 참조가 발생합니다: ${pathText}\n` +
      `선행/후행 관계는 순환할 수 없습니다. 위 경로 중 하나의 연결을 먼저 해제하세요.`,
    cycle,
  );
}

/** 순환 참조 전용 에러. API 라우트에서 409 로 변환한다. */
export class DependencyCycleError extends Error {
  readonly cycle: string[];

  constructor(message: string, cycle: string[]) {
    super(message);
    this.name = "DependencyCycleError";
    this.cycle = cycle;
  }
}

// ---------------------------------------------------------------------------
// 조상 / 자손
// ---------------------------------------------------------------------------

/** 특정 노드의 모든 선행 노드(직접 + 간접). 자기 자신은 포함하지 않는다. */
export function getAncestors(
  nodeId: string,
  edges: readonly DependencyEdge[],
): Set<string> {
  const { predecessors } = buildAdjacency(edges);
  const result = new Set<string>();
  const stack = [...(predecessors.get(nodeId) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (result.has(current) || current === nodeId) continue;
    result.add(current);
    stack.push(...(predecessors.get(current) ?? []));
  }

  return result;
}

/** 특정 노드의 모든 후행 노드(직접 + 간접). 자기 자신은 포함하지 않는다. */
export function getDescendants(
  nodeId: string,
  edges: readonly DependencyEdge[],
): Set<string> {
  const { successors } = buildAdjacency(edges);
  const result = new Set<string>();
  const stack = [...(successors.get(nodeId) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (result.has(current) || current === nodeId) continue;
    result.add(current);
    stack.push(...(successors.get(current) ?? []));
  }

  return result;
}

/**
 * 특정 노드와 연결된 부분 그래프(조상 + 자손 + 자기 자신)를 추출한다.
 * 업무 상세 화면의 의존 그래프 시각화에 사용한다.
 */
export function extractSubgraph(
  nodeId: string,
  edges: readonly DependencyEdge[],
): { nodes: Set<string>; edges: DependencyEdge[] } {
  const nodes = new Set<string>([nodeId]);
  for (const id of getAncestors(nodeId, edges)) nodes.add(id);
  for (const id of getDescendants(nodeId, edges)) nodes.add(id);

  const subEdges = edges.filter(
    (e) => nodes.has(e.predecessorId) && nodes.has(e.successorId),
  );

  return { nodes, edges: subEdges };
}

// ---------------------------------------------------------------------------
// 위상 정렬
// ---------------------------------------------------------------------------

/**
 * 위상 정렬 (Kahn 알고리즘). 선행 업무가 항상 후행보다 앞에 온다.
 *
 * @param nodeIds 정렬 대상 노드. 간선에 등장하지 않는 고립 노드도 포함하려면 명시한다.
 * @returns 정렬된 노드 배열. 순환이 있으면 null.
 */
export function topologicalOrder(
  nodeIds: readonly string[],
  edges: readonly DependencyEdge[],
): string[] | null {
  const allNodes = new Set<string>(nodeIds);
  for (const e of edges) {
    allNodes.add(e.predecessorId);
    allNodes.add(e.successorId);
  }

  const inDegree = new Map<string, number>();
  for (const node of allNodes) inDegree.set(node, 0);

  const successors = new Map<string, string[]>();
  for (const { predecessorId, successorId } of edges) {
    inDegree.set(successorId, (inDegree.get(successorId) ?? 0) + 1);
    const list = successors.get(predecessorId);
    if (list) list.push(successorId);
    else successors.set(predecessorId, [successorId]);
  }

  // 결과가 실행마다 달라지지 않도록 정렬해 큐에 넣는다.
  const queue = [...allNodes].filter((n) => inDegree.get(n) === 0).sort();
  const result: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);

    const nextNodes = [...(successors.get(node) ?? [])].sort();
    for (const next of nextNodes) {
      const degree = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
    queue.sort();
  }

  return result.length === allNodes.size ? result : null;
}

// ---------------------------------------------------------------------------
// 그래프 레이아웃 (시각화용)
// ---------------------------------------------------------------------------

export interface LayoutNode {
  id: string;
  /** 0 = 선행이 없는 최상위. 값이 클수록 후행. */
  layer: number;
  /** 같은 레이어 내 순서 (0부터) */
  indexInLayer: number;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  layerCount: number;
  /** 레이어별 노드 수의 최대값. SVG 높이 계산에 사용. */
  maxLayerSize: number;
}

/**
 * 계층형 레이아웃을 계산한다 (longest-path layering).
 * 각 노드의 레이어 = 모든 선행 노드 레이어의 최댓값 + 1
 *
 * 순환이 있으면 방문 집합으로 차단해 부분적인 결과라도 반환한다
 * (그래프를 아예 못 그리는 것보다 낫다).
 */
export function computeLayeredLayout(
  nodeIds: readonly string[],
  edges: readonly DependencyEdge[],
): GraphLayout {
  const { predecessors } = buildAdjacency(edges);
  const allNodes = new Set<string>(nodeIds);
  for (const e of edges) {
    allNodes.add(e.predecessorId);
    allNodes.add(e.successorId);
  }

  const layerOf = new Map<string, number>();

  function resolveLayer(node: string, visiting: Set<string>): number {
    const cached = layerOf.get(node);
    if (cached !== undefined) return cached;

    // 순환 방어: 이미 탐색 중인 노드를 다시 만나면 0 으로 끊는다.
    if (visiting.has(node)) return 0;
    visiting.add(node);

    const preds = predecessors.get(node) ?? [];
    const layer =
      preds.length === 0
        ? 0
        : Math.max(...preds.map((p) => resolveLayer(p, visiting))) + 1;

    visiting.delete(node);
    layerOf.set(node, layer);
    return layer;
  }

  for (const node of allNodes) resolveLayer(node, new Set());

  // 레이어별로 묶고 ID 순으로 정렬해 렌더 결과를 안정화한다.
  const byLayer = new Map<number, string[]>();
  for (const node of [...allNodes].sort()) {
    const layer = layerOf.get(node) ?? 0;
    const list = byLayer.get(layer);
    if (list) list.push(node);
    else byLayer.set(layer, [node]);
  }

  const nodes: LayoutNode[] = [];
  let maxLayerSize = 0;
  for (const [layer, list] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    maxLayerSize = Math.max(maxLayerSize, list.length);
    list.forEach((id, indexInLayer) => {
      nodes.push({ id, layer, indexInLayer });
    });
  }

  return {
    nodes,
    layerCount: byLayer.size,
    maxLayerSize,
  };
}
