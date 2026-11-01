r"""KB-5 장소 카드 코퍼스 — 공유본 전부(숙소 제외)를 한 줄씩 `data/place_cards.jsonl.gz` 로 (API 호출 0, 결정론).

    uv run python scripts/collect/build_place_cards.py
"""

from __future__ import annotations

import gzip
import json
import os
import sys
from collections import Counter
from pathlib import Path

_AI = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI / "src"))

from trippilot.orchestrator.place_intro import clean_intro  # noqa: E402
from trippilot.poi_curation.place_cards import card_text  # noqa: E402
from trippilot.poi_curation.place_docs import MIN_DOC_CHARS  # noqa: E402

_POIS, _OUT = _AI / "data" / "collected_pois.json", _AI / "data" / "place_cards.jsonl.gz"


def main() -> None:
    proposals = json.loads(_POIS.read_text(encoding="utf-8"))["proposals"]
    seen: dict[str, str] = {}
    collisions, rows, short = Counter(), [], 0
    for p in proposals:
        ref = str((p.get("provenance") or {}).get("content_id") or "")
        if not ref or (p.get("poi") or {}).get("category") == "STAY":
            continue
        if ref in seen:  # 출처가 다른 같은 id(카카오·관광공사 숫자 id 공간) — 남의 카드를 붙이지 않게 둘 다 뺀다
            collisions[seen[ref] + "/" + str(p.get("source"))] += 1
            seen[ref] = "COLLIDE"
            continue
        seen[ref] = str(p.get("source"))
        # 진짜 문서와 같은 문턱 — 출구 게이트에 걸릴 문장은 빼고(소개 게이트), 남은 것이 너무 짧으면 싣지 않는다(동네 이름만 남는 곳)
        text = clean_intro(card_text(p))
        if len(text) < MIN_DOC_CHARS:
            short += 1
            continue
        rows.append((ref, p["poi"]["name"], text))
    rows = [r for r in rows if seen[r[0]] != "COLLIDE"]
    tmp = _OUT.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        for ref, name, text in sorted(rows):
            f.write(json.dumps({"poi_ref": ref, "title": name, "source": "card", "text": text}, ensure_ascii=False) + "\n")
    os.replace(tmp, _OUT)
    print(f"카드 {len(rows)}곳 → {_OUT.name} · 너무 짧아 뺀 곳 {short} · id 충돌로 뺀 곳 {dict(collisions)}")


if __name__ == "__main__":
    main()
