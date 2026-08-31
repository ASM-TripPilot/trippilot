#!/usr/bin/env python3
"""남은 백엔드 작업 그래프 — 층·자원 충돌·mermaid 산출

정본: backend/docs/design/work-graph.toml

**손으로 세지 않는다.** 층을 표로 적어 두면 티켓 하나 늘 때마다 전체를 다시 짜야 하고,
파일 충돌은 사람이 훑으면 반드시 놓친다(스택 머지에서 openapi.yaml 중복 키를 실제로 놓쳤다).

사용법:
    python3 backend/scripts/work_graph.py            # 층 + 충돌 + 미검증 간선
    python3 backend/scripts/work_graph.py --mermaid  # 그림용 mermaid

읽기 전용이다 — 정본을 고치는 것은 사람이고, 이 스크립트는 정본에서 파생만 만든다.
"""
import sys
import tomllib
from collections import defaultdict
from pathlib import Path

GRAPH = Path(__file__).resolve().parent.parent / "docs" / "design" / "work-graph.toml"

# 이 상태의 노드는 우리가 착수할 수 없다 — 층 계산에서 빼고 따로 보고한다.
NOT_OURS = {"external", "deferred"}


def load():
    data = tomllib.loads(GRAPH.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in data["nodes"]}
    edges = data.get("edges", [])
    for e in edges:
        for side in ("from", "to"):
            if e[side] not in nodes:
                raise SystemExit(f"간선이 없는 노드를 가리킨다: {e[side]}")
    return nodes, edges


def layers(nodes, edges):
    """위상 층. 사이클이 있으면 남은 노드를 그대로 돌려준다 — 조용히 빠뜨리지 않는다."""
    incoming = defaultdict(set)
    for e in edges:
        incoming[e["to"]].add(e["from"])

    remaining = dict(nodes)
    placed, out = set(), []
    while remaining:
        level = [i for i in remaining if not (incoming[i] - placed)]
        if not level:
            out.append(("사이클", sorted(remaining)))
            break
        level.sort()
        out.append((f"층 {len(out)}", level))
        placed |= set(level)
        for i in level:
            del remaining[i]
    return out


def collisions(nodes, level_ids):
    """
    같은 층에서 같은 파일을 건드리는 노드들. **논리 의존이 아니라 병렬성 제약이다** —
    그래서 간선이 아니라 여기서 파생한다. 간선으로 넣으면 순서가 없는 것에 순서가 생겨 층이 왜곡된다.

    쌍이 아니라 **경로별로 묶는다.** openapi.yaml 처럼 여섯이 함께 만지는 파일은 쌍으로 늘어놓으면
    같은 말이 열다섯 줄이 되어 정작 드문 충돌이 묻힌다.
    """
    by_path = defaultdict(list)
    for i in level_ids:
        for t in nodes[i].get("touches", []):
            by_path[t].append(i)
    hits = sorted((p, sorted(ids)) for p, ids in by_path.items() if len(ids) > 1)
    mig = sorted(i for i in level_ids if nodes[i].get("migration"))
    return hits, mig


def main():
    nodes, edges = load()
    if "--mermaid" in sys.argv:
        print("graph LR")
        for i, n in nodes.items():
            print(f'  {i.replace("-", "_")}["{i}<br/>{n["title"][:38]}"]')
        for e in edges:
            f, t = e["from"].replace("-", "_"), e["to"].replace("-", "_")
            print(f'  {f} -->|{e["kind"]}| {t}')
        return

    ours = {i: n for i, n in nodes.items() if n.get("status") not in NOT_OURS}
    ours_edges = [e for e in edges if e["from"] in ours and e["to"] in ours]

    print(f"노드 {len(nodes)} (우리 몫 {len(ours)}) · 간선 {len(edges)}\n")

    for name, ids in layers(ours, ours_edges):
        print(f"── {name} ──")
        for i in ids:
            n = nodes[i]
            mark = " [마이그레이션]" if n.get("migration") else ""
            print(f"  {i:<22} {n['status']:<9} {n['title'][:62]}{mark}")
        hits, mig = collisions(nodes, ids)
        for path, who in hits:
            print(f"  ⚠ 공유 자원 {path}")
            print(f"      {len(who)}개가 함께 만진다: {', '.join(who)}")
        if len(mig) > 1:
            print(f"  ⚠ 같은 층 마이그레이션 번호 경합: {', '.join(mig)} — 착수 전에 번호를 못 박는다")
        print()

    blocked = sorted(i for i, n in nodes.items() if n.get("status") in NOT_OURS)
    if blocked:
        print("── 우리가 못 푸는 것 ──")
        for i in blocked:
            n = nodes[i]
            print(f"  {i:<22} {n.get('owner', '?'):<5} {n['title'][:62]}")
        print()

    unverified = [e for e in edges if not e.get("verified")]
    if unverified:
        print(f"── 미검증 간선 {len(unverified)}/{len(edges)} ──")
        print("  끊고 후행을 빌드해 실제로 깨지는지 확인하기 전까지는 주장일 뿐이다.")
        for e in unverified:
            print(f"  {e['from']} → {e['to']}  ({e['kind']})")


if __name__ == "__main__":
    main()
