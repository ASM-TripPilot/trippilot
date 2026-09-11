"""자유 입력 → 지시(KB-4) 매칭 임계 측정 — `DEFAULT_MATCH_THRESHOLD` 의 근거.

## 왜 이 파일이 있나

임계를 감으로 정하면 **예외도 로그도 없이 품질만 조용히 떨어진다** — 너무 높으면
사용자가 말한 지시를 놓치고(무반응), 너무 낮으면 말하지 않은 방향으로 후보가 틀어진다
(오작동). 둘 다 200 응답이라 안 보인다. `measure_kb_topk.py` 와 같은 취지다:
**수치를 주석에 적는 대신 재현 스크립트를 남긴다.**

## 실행

    TRIPPILOT_EMBEDDING_PROVIDER=http \\
    TRIPPILOT_EMBEDDING_BASE_URL=http://localhost:8100 \\
    TRIPPILOT_VECTOR_DB_URL=postgresql://ai_kb:ai_kb@localhost:5433/ai_kb \\
    uv run python scripts/measure_directive_match.py

사전이 적재돼 있어야 한다 — `uv run python scripts/load_kb.py data/replan_directives.yaml`.

## 평가 집합

`POSITIVES` 는 "이 발화는 이 지시를 뜻한다", `NEGATIVES` 는 "어떤 지시도 아니다"다.
후자가 중요하다 — 잡음의 최고점이 정답의 하한보다 낮아야 임계를 그 사이에 둘 수 있다.
발화는 **사전의 alias 를 그대로 쓰지 않는다**(그러면 코사인 1.0 이라 아무것도 못 잰다).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import yaml  # noqa: E402

from trippilot.agents.adapters.pgvector_store import PgVectorStore  # noqa: E402
from trippilot.agents.planb.directives import (  # noqa: E402
    DEFAULT_MATCH_TOP_K,
    load_directive_file,
)
from trippilot.agents.planb.kb_retrieval import retrieve  # noqa: E402
from trippilot.domain.kb import KbKind  # noqa: E402

# (발화, 기대 지시 집합) — alias 원문이 아니라 사용자가 칠 법한 말로 쓴다.
POSITIVES: list[tuple[str, set[str]]] = [
    ("비 오니까 실내 위주로 해줘", {"INDOOR"}),
    ("밖은 비가 와서 건물 안에서 할 수 있는 걸로", {"INDOOR"}),
    ("날씨 좋으니까 바깥 구경 하고 싶어", {"OUTDOOR"}),
    ("점심 먹을 만한 데 넣어줘", {"ADD_FOOD"}),
    ("커피 마시면서 쉴 데 하나 있으면 좋겠어", {"ADD_CAFE"}),
    ("밤에 경치 좋은 곳 가고 싶어", {"NIGHT_VIEW"}),
    ("전시 같은 거 보고 싶은데", {"CULTURE_FOCUS"}),
    ("바다가 보이는 데로 가자", {"NATURE_FOCUS"}),
    ("유명한 관광지 위주로 돌래", {"SIGHT_FOCUS"}),
    ("기념품 살 데 있으면 좋겠다", {"SHOPPING_FOCUS"}),
    ("뭔가 체험할 수 있는 거 하고 싶어", {"ACTIVITY_FOCUS"}),
    ("체력이 달려서 힘든 건 빼줘", {"AVOID_STRENUOUS"}),
    ("여기서 가까운 데로만", {"NEARBY"}),
    ("많이 걷기 싫어 이동 좀 줄여줘", {"LESS_MOVE"}),
    ("마지막은 숙소 근처로 해줘", {"END_NEAR_STAY"}),
    ("천천히 여유있게 다니고 싶어", {"RELAX"}),
    ("시간 남으니까 좀 더 빡빡하게 채워줘", {"FILL_MORE"}),
    ("아침 일찍부터 시작하고 싶어", {"EARLIER"}),
    ("저녁 전에 일정 끝내고 싶어", {"SHORTER_DAY"}),
    ("저녁 예약은 그대로 두고", {"KEEP_DINNER"}),
    ("예산은 더 안 쓰고 싶어", {"KEEP_BUDGET"}),
    ("맛집 하나 넣어주고 카페도 가고 싶어", {"ADD_FOOD", "ADD_CAFE"}),
    ("비도 오고 많이 걷기도 싫어", {"INDOOR", "LESS_MOVE"}),
]

# 어떤 지시도 아닌 발화 — 여기서 뭔가 매칭되면 임계가 낮은 것이다.
NEGATIVES: list[str] = [
    "오늘 날씨가 참 좋네요",
    "안녕하세요",
    "이 일정 괜찮은 것 같아요",
    "고맙습니다",
    "여행 재미있었어요",
    "잘 모르겠어요",
    "네",
    "부산 처음 와봐요",
]

SWEEP = (0.60, 0.65, 0.70, 0.72, 0.74, 0.76, 0.78, 0.80, 0.82, 0.85)


def _embedding():
    provider = (os.environ.get("TRIPPILOT_EMBEDDING_PROVIDER") or "").lower()
    if provider != "http":
        raise SystemExit("TRIPPILOT_EMBEDDING_PROVIDER=http 로 실행할 것 — 운영과 같은 경로")
    from trippilot.llm_gateway.adapters.http_embedding_assembly import http_embedding
    from trippilot.poi_curation.adapters.backend_poi_db import UrllibJsonClient

    return http_embedding(SystemExit, lambda t: UrllibJsonClient(timeout_sec=t))


def _keys_above(hits, threshold: float, cap: int) -> set[str]:
    """`match_free_text` 와 같은 규칙 — 임계 이상, 같은 key 접기, 상한."""
    out: list[str] = []
    for hit in hits:
        if hit.score < threshold:
            continue
        key = (hit.metadata or {}).get("key")
        if isinstance(key, str) and key not in out:
            out.append(key)
        if len(out) >= cap:
            break
    return set(out)


def main() -> None:
    dsn = os.environ.get("TRIPPILOT_VECTOR_DB_URL")
    if not dsn:
        raise SystemExit("TRIPPILOT_VECTOR_DB_URL 미설정")
    import psycopg

    embedding = _embedding()
    store = PgVectorStore(lambda: psycopg.connect(dsn))
    root = Path(__file__).resolve().parent.parent
    specs = load_directive_file(root / "data" / "replan_directives.yaml", yaml.safe_load)
    print(f"사전 {len(specs)}종 · 평가 정답 {len(POSITIVES)}건 · 비지시 {len(NEGATIVES)}건\n")

    # 검색은 한 번만 하고 임계만 바꿔 가며 재평가한다 (임베딩 왕복이 비싸다).
    pos_hits = [(t, want, retrieve(KbKind.DIRECTIVE, t, embedding, store, top_k=12))
                for t, want in POSITIVES]
    neg_hits = [(t, retrieve(KbKind.DIRECTIVE, t, embedding, store, top_k=12))
                for t in NEGATIVES]

    print("## 정답 발화의 1위 점수 (낮은 순) — 임계의 상한을 정한다\n")
    firsts = []
    for text, want, hits in pos_hits:
        top = hits[0] if hits else None
        key = (top.metadata or {}).get("key") if top else None
        firsts.append((top.score if top else 0.0, key in want, text, key))
    for score, right, text, key in sorted(firsts)[:8]:
        print(f"  {score:.3f} {'O' if right else 'X'} {key or '-':16s} {text}")

    print("\n## 비지시 발화의 1위 점수 (높은 순) — 임계의 하한을 정한다\n")
    noise = sorted(
        ((h[0].score if h else 0.0, (h[0].metadata or {}).get("key") if h else None, t)
         for t, h in neg_hits), reverse=True)
    for score, key, text in noise[:5]:
        print(f"  {score:.3f}   {key or '-':16s} {text}")

    print("\n## 임계 스윕\n")
    print("| 임계 | 정확일치 | 부분누락 | 과다선택 | 오검출(비지시) |")
    print("|---:|---:|---:|---:|---:|")
    for th in SWEEP:
        exact = partial = over = 0
        for _t, want, hits in pos_hits:
            got = _keys_above(hits, th, DEFAULT_MATCH_TOP_K)
            if got == want:
                exact += 1
            elif got < want:
                partial += 1
            elif not (got <= want):
                over += 1
        false_pos = sum(1 for _t, hits in neg_hits if _keys_above(hits, th, DEFAULT_MATCH_TOP_K))
        print(f"| {th:.2f} | {exact}/{len(POSITIVES)} | {partial} | {over} | "
              f"{false_pos}/{len(NEGATIVES)} |")

    print("\n정확일치가 최대이면서 오검출 0 인 구간의 **가운데**를 고른다 — 가장자리를 고르면"
          "\n사전이 조금만 늘어도 넘어간다.")


if __name__ == "__main__":
    main()
