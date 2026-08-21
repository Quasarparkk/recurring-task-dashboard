import { describe, expect, it } from "vitest";

import {
  assertNoCycle,
  buildAdjacency,
  computeLayeredLayout,
  DependencyCycleError,
  extractSubgraph,
  findCycle,
  getAncestors,
  getDescendants,
  topologicalOrder,
  type DependencyEdge,
} from "./graph";

/** `"A>B"` 형태의 축약 표기로 간선을 만든다. */
function edges(...specs: string[]): DependencyEdge[] {
  return specs.map((spec) => {
    const [predecessorId, successorId] = spec.split(">");
    return { predecessorId, successorId };
  });
}

describe("buildAdjacency", () => {
  it("선행/후행 인접 리스트를 만든다", () => {
    const { successors, predecessors, nodes } = buildAdjacency(edges("A>B", "A>C", "B>D"));

    expect(successors.get("A")).toEqual(["B", "C"]);
    expect(successors.get("B")).toEqual(["D"]);
    expect(predecessors.get("D")).toEqual(["B"]);
    expect(predecessors.get("A")).toBeUndefined();
    expect([...nodes].sort()).toEqual(["A", "B", "C", "D"]);
  });
});

describe("findCycle", () => {
  it("순환이 없으면 null", () => {
    expect(findCycle(edges("A>B", "B>C", "A>C"))).toBeNull();
  });

  it("빈 그래프는 null", () => {
    expect(findCycle([])).toBeNull();
  });

  it("직접 순환(A→B→A)을 찾는다", () => {
    const cycle = findCycle(edges("A>B", "B>A"));
    expect(cycle).not.toBeNull();
    // 경로의 시작과 끝이 같은 노드여야 한다
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
    expect(new Set(cycle)).toEqual(new Set(["A", "B"]));
  });

  it("긴 순환(A→B→C→A)을 찾는다", () => {
    const cycle = findCycle(edges("A>B", "B>C", "C>A"));
    expect(cycle).not.toBeNull();
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
    expect(cycle).toHaveLength(4);
  });

  it("자기 자신을 향하는 간선을 찾는다", () => {
    expect(findCycle(edges("A>A"))).toEqual(["A", "A"]);
  });

  it("순환이 없는 부분과 있는 부분이 섞여 있어도 찾는다", () => {
    const cycle = findCycle(edges("X>Y", "Y>Z", "A>B", "B>C", "C>A"));
    expect(cycle).not.toBeNull();
    expect(new Set(cycle)).toEqual(new Set(["A", "B", "C"]));
  });

  it("다이아몬드 구조는 순환이 아니다", () => {
    // A → B → D, A → C → D
    expect(findCycle(edges("A>B", "A>C", "B>D", "C>D"))).toBeNull();
  });
});

describe("assertNoCycle", () => {
  it("순환이 없으면 통과한다", () => {
    expect(() =>
      assertNoCycle(edges("A>B", "B>C"), { predecessorId: "C", successorId: "D" }),
    ).not.toThrow();
  });

  it("순환이 생기면 DependencyCycleError 를 던진다", () => {
    expect(() =>
      assertNoCycle(edges("A>B", "B>C"), { predecessorId: "C", successorId: "A" }),
    ).toThrow(DependencyCycleError);
  });

  it("에러 메시지에 업무 제목으로 된 경로가 담긴다", () => {
    const titles: Record<string, string> = {
      A: "급여 마감",
      B: "급여 이체",
      C: "급여 대장 보관",
    };

    try {
      assertNoCycle(
        edges("A>B", "B>C"),
        { predecessorId: "C", successorId: "A" },
        (id) => titles[id] ?? id,
      );
      throw new Error("에러가 발생하지 않았습니다");
    } catch (error) {
      expect(error).toBeInstanceOf(DependencyCycleError);
      const message = (error as Error).message;
      expect(message).toContain("순환 참조가 발생합니다");
      expect(message).toContain("급여 마감");
      expect(message).toContain("급여 이체");
      expect(message).toContain("급여 대장 보관");
    }
  });

  it("자기 자신을 선행으로 지정하면 전용 메시지를 준다", () => {
    try {
      assertNoCycle([], { predecessorId: "A", successorId: "A" }, () => "월 마감");
      throw new Error("에러가 발생하지 않았습니다");
    } catch (error) {
      expect((error as Error).message).toContain("자기 자신의 선행 업무로 지정할 수 없습니다");
      expect((error as Error).message).toContain("월 마감");
    }
  });

  it("이미 존재하는 간선을 다시 추가해도 통과한다", () => {
    expect(() =>
      assertNoCycle(edges("A>B"), { predecessorId: "A", successorId: "B" }),
    ).not.toThrow();
  });

  it("간접 순환도 차단한다 (A→B→C→D, D→A 추가)", () => {
    expect(() =>
      assertNoCycle(edges("A>B", "B>C", "C>D"), { predecessorId: "D", successorId: "A" }),
    ).toThrow(DependencyCycleError);
  });

  it("역방향 간선 추가는 순환이다 (A→B 존재, B→A 추가)", () => {
    expect(() =>
      assertNoCycle(edges("A>B"), { predecessorId: "B", successorId: "A" }),
    ).toThrow(DependencyCycleError);
  });

  it("병렬 경로 추가는 순환이 아니다", () => {
    // A→B, A→C 에 B→D, C→D 추가 (다이아몬드)
    expect(() =>
      assertNoCycle(edges("A>B", "A>C", "B>D"), {
        predecessorId: "C",
        successorId: "D",
      }),
    ).not.toThrow();
  });
});

describe("getAncestors / getDescendants", () => {
  const graph = edges("A>B", "B>C", "C>D", "X>C");

  it("모든 선행(직접 + 간접)을 찾는다", () => {
    expect(getAncestors("D", graph)).toEqual(new Set(["A", "B", "C", "X"]));
    expect(getAncestors("C", graph)).toEqual(new Set(["A", "B", "X"]));
    expect(getAncestors("A", graph)).toEqual(new Set());
  });

  it("모든 후행(직접 + 간접)을 찾는다", () => {
    expect(getDescendants("A", graph)).toEqual(new Set(["B", "C", "D"]));
    expect(getDescendants("X", graph)).toEqual(new Set(["C", "D"]));
    expect(getDescendants("D", graph)).toEqual(new Set());
  });

  it("자기 자신은 포함하지 않는다", () => {
    expect(getAncestors("C", graph).has("C")).toBe(false);
    expect(getDescendants("C", graph).has("C")).toBe(false);
  });

  it("순환이 있어도 무한 루프에 빠지지 않는다", () => {
    const cyclic = edges("A>B", "B>C", "C>A");
    expect(getAncestors("A", cyclic)).toEqual(new Set(["B", "C"]));
    expect(getDescendants("A", cyclic)).toEqual(new Set(["B", "C"]));
  });
});

describe("extractSubgraph", () => {
  it("연결된 노드와 간선만 추출한다", () => {
    const graph = edges("A>B", "B>C", "P>Q"); // P,Q 는 별개 그래프
    const { nodes, edges: subEdges } = extractSubgraph("B", graph);

    expect(nodes).toEqual(new Set(["A", "B", "C"]));
    expect(subEdges).toHaveLength(2);
    expect(subEdges).toEqual(
      expect.arrayContaining([
        { predecessorId: "A", successorId: "B" },
        { predecessorId: "B", successorId: "C" },
      ]),
    );
  });

  it("고립 노드는 자기 자신만 포함한다", () => {
    const { nodes, edges: subEdges } = extractSubgraph("Z", edges("A>B"));
    expect(nodes).toEqual(new Set(["Z"]));
    expect(subEdges).toHaveLength(0);
  });
});

describe("topologicalOrder", () => {
  it("선행이 항상 후행보다 앞에 온다", () => {
    const order = topologicalOrder([], edges("A>B", "B>C", "A>C"));
    expect(order).toEqual(["A", "B", "C"]);
  });

  it("고립 노드도 포함한다", () => {
    const order = topologicalOrder(["Z"], edges("A>B"));
    expect(order).not.toBeNull();
    expect(new Set(order!)).toEqual(new Set(["A", "B", "Z"]));
  });

  it("순환이 있으면 null", () => {
    expect(topologicalOrder([], edges("A>B", "B>A"))).toBeNull();
  });

  it("결과가 결정적이다 (같은 입력 → 같은 출력)", () => {
    const graph = edges("A>D", "B>D", "C>D");
    expect(topologicalOrder([], graph)).toEqual(topologicalOrder([], graph));
    expect(topologicalOrder([], graph)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("computeLayeredLayout", () => {
  it("선행이 없는 노드는 레이어 0", () => {
    const { nodes } = computeLayeredLayout([], edges("A>B", "B>C"));
    const layerOf = new Map(nodes.map((n) => [n.id, n.layer]));

    expect(layerOf.get("A")).toBe(0);
    expect(layerOf.get("B")).toBe(1);
    expect(layerOf.get("C")).toBe(2);
  });

  it("가장 긴 경로 기준으로 레이어를 정한다", () => {
    // A→B→C→D 와 A→D 가 동시에 있으면 D 는 레이어 3
    const { nodes, layerCount } = computeLayeredLayout(
      [],
      edges("A>B", "B>C", "C>D", "A>D"),
    );
    const layerOf = new Map(nodes.map((n) => [n.id, n.layer]));

    expect(layerOf.get("D")).toBe(3);
    expect(layerCount).toBe(4);
  });

  it("같은 레이어의 노드에 순서를 부여한다", () => {
    const { nodes, maxLayerSize } = computeLayeredLayout([], edges("A>C", "B>C"));
    const layer0 = nodes.filter((n) => n.layer === 0).sort((a, b) => a.indexInLayer - b.indexInLayer);

    expect(layer0.map((n) => n.id)).toEqual(["A", "B"]);
    expect(layer0.map((n) => n.indexInLayer)).toEqual([0, 1]);
    expect(maxLayerSize).toBe(2);
  });

  it("고립 노드는 레이어 0 에 놓는다", () => {
    const { nodes } = computeLayeredLayout(["Z"], []);
    expect(nodes).toEqual([{ id: "Z", layer: 0, indexInLayer: 0 }]);
  });

  it("순환이 있어도 결과를 반환한다 (무한 루프 방지)", () => {
    const { nodes } = computeLayeredLayout([], edges("A>B", "B>C", "C>A"));
    expect(nodes).toHaveLength(3);
    // 순환을 끊어 레이어가 부여되었는지만 확인한다
    expect(nodes.every((n) => Number.isFinite(n.layer))).toBe(true);
  });
});
