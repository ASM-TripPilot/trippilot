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

# 남의 몫. **층 계산에서 빼지 않는다** — 빼면 그것을 기다리는 우리 노드가 선행을 잃고 층 0 으로
# 올라와 "지금 착수 가능"처럼 보인다. 남겨 두고 표시에서만 구분한다.
NOT_OURS = {"external", "deferred"}

# 끝난 것. 층에서 빼되 **지우지는 않는다** — 지우면 그 노드가 무엇을 막고 있었는지,
# 왜 그렇게 갈랐는지가 함께 사라진다. 간선의 선행이 충족됐는지 판정에도 필요하다.
DONE = {"done"}

# 안 하기로 한 것. **`done` 도 `external`·`deferred` 도 아니다** — 끝낸 것이 아니고 남의 몫도 아니다.
# 셋 중 아무 데나 넣으면 표시가 거짓말을 한다. 따로 두는 실익은 `ours` 에서 빠지는 것이다:
# 안 그러면 접은 노드가 **남은 작업 수에 계속 잡히고**, 쓰지도 않을 Flyway 번호로 경합 경고까지 만든다
# (실측: STAY-CONTENT-TOURAPI 를 접었는데 "남은 우리 몫"과 번호 경합 목록에 그대로 남았다).
# 되살릴 조건은 노드 note 가 갖는다 — 그래서 지우지 않고 아래에서 따로 보여 준다.
DROPPED = {"dropped"}

# 우리가 지금 할 수 있는/해야 하는 것. 위 셋에 안 들어가는 나머지가 여기다.
OURS_STATUS = {"todo", "blocked"}

KNOWN_STATUS = NOT_OURS | DONE | DROPPED | OURS_STATUS


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


def collisions(nodes, ids):
    """
    같은 파일을 건드리는 노드들. **논리 의존이 아니라 병렬성 제약이다** —
    그래서 간선이 아니라 여기서 파생한다. 간선으로 넣으면 순서가 없는 것에 순서가 생겨 층이 왜곡된다.

    쌍이 아니라 **경로별로 묶는다.** openapi.yaml 처럼 여덟이 함께 만지는 파일을 쌍으로 늘어놓으면
    같은 말이 스물여덟 줄이 되어 정작 드문 충돌이 묻힌다.
    """
    by_path = defaultdict(list)
    for i in ids:
        for t in nodes[i].get("touches", []):
            by_path[t].append(i)
    hits = sorted((p, sorted(ids)) for p, ids in by_path.items() if len(ids) > 1)
    mig = sorted(i for i in ids if nodes[i].get("migration"))
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

    # 모르는 status 를 조용히 "남은 작업"으로 세지 않는다. 아래 `not in` 은 **모르는 값을 전부
    # 우리 몫으로 흘려 보내므로**, 오타든 새 어휘든 티가 안 난다 — 실제로 `dropped` 가 그렇게
    # 들어와 접은 노드가 남은 작업 수와 Flyway 경합 목록에 계속 잡혔다. 여기서 크게 실패시킨다.
    unknown = sorted({n.get("status") for n in nodes.values()} - (KNOWN_STATUS))
    if unknown:
        sys.exit(f"work-graph.toml: 모르는 status {unknown} — 어휘를 늘렸으면 이 스크립트에도 뜻을 정해라.")

    ours = [i for i, n in nodes.items() if n.get("status") not in NOT_OURS | DONE | DROPPED]
    done = sorted(i for i, n in nodes.items() if n.get("status") in DONE)
    print(f"노드 {len(nodes)} (남은 우리 몫 {len(ours)} · 완료 {len(done)}) · 간선 {len(edges)}")
    if done:
        print(f"완료: {', '.join(done)}")
    print()

    for name, ids in layers(nodes, edges):
        # 남의 몫만 있는 층은 굳이 층으로 그리지 않는다 — 아래 별도 절에서 보여 준다.
        mine = [i for i in ids if i in ours]
        if not mine:
            continue
        print(f"── {name} ──")
        for i in mine:
            n = nodes[i]
            mark = " [마이그레이션]" if n.get("migration") else ""
            print(f"  {i:<22} {n['status']:<9} {n['title'][:62]}{mark}")
        print()

    # 충돌은 **층과 무관하게** 본다. 층이 다르다고 동시에 작업하지 않는 것이 아니다 —
    # 층은 논리적 선행일 뿐이고, 같은 파일을 만지면 언제 하든 서로의 diff 를 밟는다.
    hits, mig = collisions(nodes, ours)
    if hits or len(mig) > 1:
        print("── 공유 자원(병렬성 제약) ──")
        for path, who in hits:
            print(f"  ⚠ {path}")
            print(f"      {len(who)}개가 함께 만진다: {', '.join(who)}")
        if len(mig) > 1:
            print(f"  ⚠ Flyway 번호 경합: {', '.join(mig)} — 동시에 열려면 번호를 먼저 못 박는다")
        print()

    dropped = sorted(i for i, n in nodes.items() if n.get("status") in DROPPED)
    if dropped:
        # 지우지 않고 보여 주는 이유 — 같은 조사를 다음 사람이 처음부터 다시 하지 않게.
        print("── 접은 것(되살릴 조건은 노드 note) ──")
        for i in dropped:
            n = nodes[i]
            print(f"  {i:<22} {n.get('owner', '?'):<5} {n['title'][:62]}")
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
