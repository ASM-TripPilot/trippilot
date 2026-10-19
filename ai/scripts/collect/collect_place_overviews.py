"""KB-5 장소 지식 2단계 — 관광공사 개요(`detailCommon2` 의 `overview`)를 코퍼스로 모은다 (2026-10-19 사용자 승인).

위키(1단계, #1363)는 1,962곳뿐이다. 관광공사 장소는 20,940곳이고 대부분 개요 원문을 갖는다(채움률은 이 수집이
처음 잰다). 하루 한도(키 3개 × 오퍼레이션별 1,000 — detailCommon2 는 매일 POI 수집이 안 쓴다)라 **여러 날에 걸쳐**
받는다. 누적본은 `overview-state` 전용 브랜치(ai-overview-collect.yml)에 두고, 이미 받은 content_id(개요가
비었던 것 포함)는 다시 부르지 않는다.

순서는 content_id 해시 순이다 — 앞 N건이 지역·유형이 고르게 섞인 표본이 된다. 첫 실행(200건)의 길이 분포로
조각 수·벡터 파일 크기를 가늠해 저장 방식을 정한다(위키 1.4만 조각 = 27.8MB).

실행 (관광공사 키는 GitHub 시크릿에만 있다 — 로컬 실행은 키를 직접 줄 때만):
    TOUR_API_KEY=... uv run python scripts/collect/collect_place_overviews.py --max-calls 200
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import html
import json
import os
import re
import statistics
import sys
from pathlib import Path

_AI = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI / "src"))

from trippilot.llm_gateway.gates.base import has_contact_like  # noqa: E402
from trippilot.poi_curation.chunking import chunk_document, split_sentences  # noqa: E402
from trippilot.poi_curation.place_docs import SOURCE_OVERVIEW  # noqa: E402

_POIS = _AI / "data" / "collected_pois.json"
_OUT = _AI / "data" / "place_corpus_overview.jsonl.gz"
_LICENSE = "한국관광공사 TourAPI (출처 표시)"
_STOP_AFTER_FAILS = 5  # 연달아 실패하면 그날 한도가 끝난 것이다(429) — 받은 데까지 저장하고 멈춘다
_MAX_FAIL_RATE = 0.02
_VECTOR_BYTES = 1024 * 2  # fp16 1024차원 — gzip 뒤 실측도 조각당 약 2KB(위키 13,553조각 27.6MB)
_TAG = re.compile(r"<[^>]+>")
_BR = re.compile(r"<br\s*/?>", re.I)


def clean_overview(raw: str) -> str:
    """`<br>`·태그·HTML 엔티티를 걷고, 연락처꼴 문장(전화·URL)을 뺀다 — 후보 줄에 실리면 출력 게이트가
    그 이유를 통째로 비운다(`gates.base.has_contact_like`)."""
    text = html.unescape(_TAG.sub(" ", _BR.sub("\n", raw)))  # 태그 먼저 — 엔티티를 먼저 풀면 '&lt;국보&gt;' 가 태그로 지워진다
    text = " ".join(text.split())
    return " ".join(s for s in split_sentences(text) if not has_contact_like(s))


def targets(proposals: list[dict]) -> list[tuple[str, str]]:
    """관광공사 장소 (content_id, 이름) — 해시 순(표본이 고르게 섞인다), 중복 제거."""
    seen: dict[str, str] = {}
    for p in proposals:
        cid = str((p.get("provenance") or {}).get("content_id") or "")
        if p.get("source") == "TOURAPI" and cid and cid not in seen:
            seen[cid] = str((p.get("poi") or {}).get("name") or "")
    return sorted(seen.items(), key=lambda kv: hashlib.sha1(kv[0].encode()).hexdigest())


def row_of(cid: str, name: str, overview: str | None) -> dict:
    """코퍼스 한 줄 — 위키와 같은 꼴(`chunking.chunk_document`). 개요가 비면 절 없이 남겨 다시 안 부른다."""
    text = clean_overview(overview or "")
    return {"doc_id": f"{SOURCE_OVERVIEW}:{cid}", "poi_ref": cid, "title": name, "license": _LICENSE,
            "sections": [{"heading": "개요", "text": text}] if text else []}


def collect(adapter, todo: list[tuple[str, str]], have: dict[str, dict], max_calls: int) -> tuple[int, int]:
    """`have`(doc_id → 줄)에 없는 곳만 `max_calls` 까지 부른다. 반환 (호출 수, 실패 수)."""
    calls = failed = streak = 0
    for cid, name in todo:
        doc_id = f"{SOURCE_OVERVIEW}:{cid}"
        if doc_id in have:
            continue
        if calls >= max_calls or streak >= _STOP_AFTER_FAILS:
            break
        calls += 1
        try:
            overview = adapter.fetch_overview(cid)
        except Exception as e:  # 한 건 실패가 전체를 죽이지 않는다 — 그 건은 다음 실행이 다시 부른다
            failed += 1
            streak += 1
            print(f"  ! {cid} {name} — {type(e).__name__}: {e}", file=sys.stderr)
            continue
        streak = 0
        have[doc_id] = row_of(cid, name, overview)
    return calls, failed


def stats(rows: list[dict], total_places: int) -> str:
    """길이 분포 + 전량 환산 조각 수·벡터 크기 — 저장 방식(리포 파일 하나 / 나눔 / 바깥)을 정할 숫자."""
    filled = [r for r in rows if r["sections"]]
    if not rows:
        return "받은 것 없음"
    lengths = sorted(len(r["sections"][0]["text"]) for r in filled) or [0]
    chunks = [len(chunk_document(r)) for r in rows]
    per_place = sum(chunks) / len(rows)
    projected = per_place * total_places
    return (f"받은 곳 {len(rows)} · 개요 있음 {len(filled)} ({len(filled) / len(rows):.1%}) · "
            f"길이 중앙 {statistics.median(lengths):.0f}자 · p90 {lengths[int(len(lengths) * 0.9)]}자 · "
            f"최장 {lengths[-1]}자 · 조각 {sum(chunks)}개(곳당 {per_place:.2f}) → 전량 {total_places}곳 환산 "
            f"조각 {projected:,.0f}개 · 벡터 약 {projected * _VECTOR_BYTES / 1e6:,.0f}MB")


def _load(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return {(r := json.loads(line))["doc_id"]: r for line in f if line.strip()}


def _save(path: Path, have: dict[str, dict]) -> None:
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        for doc_id in sorted(have):
            f.write(json.dumps(have[doc_id], ensure_ascii=False) + "\n")
    tmp.replace(path)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--max-calls", type=int, default=200)
    ap.add_argument("--out", type=Path, default=_OUT)
    args = ap.parse_args(argv)
    from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter, UrllibHttpClient

    keys = [k for k in (os.environ.get(f"TOUR_API_KEY{s}") for s in ("", "2", "3")) if k]
    if not keys:
        print("TOUR_API_KEY 없음 — 생략")
        return 0
    # 키당 상한 — 오퍼레이션별 일 한도 1,000 에 여유를 둔다. 429 는 키 퇴출이 아니라 일시 장애로 올라오므로(포트 계약)
    # 한 키가 한도를 넘기면 연속 실패로 그날 수집이 멈춘다 — 넘기지 않게 여기서 자른다.
    per_key = int(os.environ.get("OVERVIEW_CALLS_PER_KEY") or "950")
    adapter = TourApiAdapter(UrllibHttpClient(), keys[0], extra_keys=keys[1:],
                             calls_per_key=per_key if len(keys) > 1 else None)
    todo = targets(json.loads(_POIS.read_text(encoding="utf-8"))["proposals"])
    have = _load(args.out)
    before = len(have)
    calls, failed = collect(adapter, todo, have, args.max_calls)
    _save(args.out, have)  # 받은 데까지는 늘 남긴다(실패율 초과여도) — 다음 실행이 이어받는다
    print(f"개요: 이번 {len(have) - before}곳 받음(호출 {calls}·실패 {failed}) · 누적 {len(have)}/{len(todo)}곳")
    print(stats(list(have.values()), len(todo)))
    if calls and failed / calls > _MAX_FAIL_RATE:
        print(f"실패율 {failed / calls:.1%} — {_MAX_FAIL_RATE:.0%} 초과(한도 소진이면 다음 실행이 이어받는다)")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
