"""상세 되감기 재조회 — 공유본 옛 수집분의 상세(detailIntro2)를 content_id 로 다시 받는다 (TRIP-1230 후속).

#949(2026-10-04)부터 원문 칸(`opening_hours_raw`)에 휴무 원문이 함께 실리지만, 일일 수집은
기제안·변경 없음(modifiedtime 동일) 항목의 상세를 다시 받지 않는다 — 공유본 대부분이 그 전에
수집돼 휴무가 없고, 벤더가 원본을 고치지 않는 한 영영 안 붙는다. 그래서 상세만 다시 받아 **정상
수집이 냈을 제안을 그대로** 다시 낸다(`pipeline.refresh_proposal` — 같은 게이트·같은 문서 모양).

대기 = TOURAPI · 상세 영업시간 필드가 있는 타입(12·14·28·38·39) · 폐업 아님 · 조회일 표지
(`provenance.detail_fetched_on`) 없음 · 이번 일일 수집분 아님(그쪽이 더 새 판이다). 표지 달린 제안이
공유본에 병합되면 대기에서 빠진다 — **대기가 0 이면 아무것도 안 한다**. 대기가 0 이 되거나 늘 실패하는 항목만
남아 '남은 대기'가 며칠째 그대로면 워크플로 스텝과 함께 지운다.

    cd ai
    uv run python scripts/refetch_intro.py --dry-run        # 대기 건수만 (호출 0, 산출 없음)
    TOUR_API_KEY3=<디코딩키> uv run python scripts/refetch_intro.py --daily collected_pois.json

산출(`--out`)은 등록 제안 문서다 — `ai-poi-collect` 가 일일 산출물 **뒤에** merge_pois_docs 로
공유본에 합친다(같은 content_id 는 나중 수집분이 이긴다). 한도 소진·키 거부·실패 우세 중단도
정상 종료(0)다 — 남은 대기는 다음 실행이 이어 받는다. 0 이 아닌 종료는 입력·프로그램 오류뿐이다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import time
from collections import Counter, deque
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path

from collect_pois import load_closed_refs
from trippilot.poi_curation.sourcing.pipeline import SCHEMA_VERSION, SOURCE_NAME, refresh_proposal
from trippilot.poi_curation.sourcing.tourapi import HttpGetJson, TourApiAdapter, UrllibHttpClient
from trippilot.ports.poi_sourcing_port import SourcingError

# (환경변수, 이번 실행 상한 — 시도 기준) 이 순서로 쓴다. KEY1 은 일일 수집이 먼저 쓰는 키라
# 여유를 남긴다(일일 ≈250콜 + 700 < 개발계정 일 1,000).
KEYS: tuple[tuple[str, int], ...] = (
    ("TOUR_API_KEY3", 1000),
    ("TOUR_API_KEY", 700),
    ("TOUR_API_KEY2", 1000),
)
_KINDS = frozenset({"12", "14", "28", "38", "39"})   # 상세 영업시간 필드가 있는 타입 (tourapi._INTRO_FIELDS)
_MAX_429_IN_A_ROW = 3   # 이만큼 연달아 429 면 그 키의 오늘 한도가 찬 것이다 — 다음 키로
_MIN_ATTEMPTS = 50      # 이만큼 시도한 뒤 실패가 절반 이상이면 망·벤더 장애다 — 남은 키를 아끼고 멈춘다
# 워크플로 스텝 timeout-minutes(40) 전에 멈춘다 — 타임아웃에 죽으면 받은 것까지 다 잃는다
_DEADLINE_SEC = 35 * 60


def select_pending(
    doc: Mapping, *, closed: frozenset[tuple[str, str]], exclude: set[str], today: str,
) -> list[dict]:
    """대기 제안 — 원문 칸이 있는 것부터(휴무가 붙으면 런타임 판정이 바로 바뀐다), 다음 원문 없는 것,
    원문 없는 레포츠(28)는 맨 뒤(상세 응답의 86.7% 가 빈 응답이다).

    같은 무리 안 순서는 **날마다 섞는다**(오늘 날짜 + content_id 의 해시 — 같은 날엔 같은 순서). 고정
    순서면 늘 실패하는 항목(실패는 표지가 안 붙어 대기로 남는다)이 매일 맨 앞에 모여, 50번 시도 뒤
    실패 절반 규칙에 걸려 되감기가 그날부터 멈춘다(25건이면 하루 25건, 60건이면 0건 — 리뷰 재현)."""
    def pending(p: Mapping) -> bool:
        prov = p.get("provenance") or {}
        return (p.get("source") == SOURCE_NAME
                and prov.get("content_type_id") in _KINDS
                and ("tourapi", prov.get("content_id")) not in closed
                and "detail_fetched_on" not in prov
                and prov.get("content_id") not in exclude)

    def order(p: Mapping) -> tuple[int, str]:
        prov = p["provenance"]
        group = 0 if p.get("opening_hours_raw") else 2 if prov["content_type_id"] == "28" else 1
        return group, hashlib.sha1(f"{today}:{prov['content_id']}".encode()).hexdigest()

    return sorted((p for p in doc["proposals"] if pending(p)), key=order)


def keys_from_env(environ: Mapping[str, str]) -> list[tuple[str, str, int]]:
    """(이름, 키, 상한) — 빈 값은 미설정이다(GH Actions 는 등록 안 된 secret 을 '' 로 넣는다)."""
    return [(name, environ[name], cap) for name, cap in KEYS if environ.get(name)]


def rewind(
    pending: Sequence[Mapping],
    keys: Sequence[tuple[str, str, int]],
    http: HttpGetJson,
    *,
    fetched_on: str,
) -> tuple[list[dict], dict]:
    """대기를 앞에서부터 키 순서대로 재조회 → (다시 낸 제안, 통계).

    키 하나 = 단일 키 어댑터 하나다. 죽은 키(403·키 resultCode)와 한도 찬 키(429 연속)는 그 키만
    접고, 다음 키가 **같은 항목부터** 이어 받는다. 그 밖의 실패(타임아웃·5xx·봉투 오류)는 그 항목만
    넘긴다 — 표지가 안 붙으니 다음 실행이 다시 묻는다.
    """
    queue = deque(pending)
    proposals: list[dict] = []
    attempted: dict[str, int] = {}
    failures: Counter[str] = Counter()
    kept = dropped = 0
    halted: str | None = None
    deadline = time.monotonic() + _DEADLINE_SEC
    for name, key, cap in keys:
        if halted or not queue:
            break
        source = TourApiAdapter(http, key)
        attempted[name] = in_a_row = 0
        while queue and attempted[name] < cap:
            if time.monotonic() >= deadline:
                halted = "deadline"
                break
            p = queue[0]
            prov = p["provenance"]
            attempted[name] += 1
            try:
                detail = source.fetch_detail(prov["content_id"], prov["content_type_id"])
            except SourcingError as e:
                print(f"[rewind] {name} 실패 contentid={prov['content_id']} — {e}", file=sys.stderr)
                if not source.alive:          # 이 키로는 오늘 안 된다 — 항목은 다음 키가 받는다
                    failures["dead_key"] += 1
                    break
                if getattr(e.__cause__, "code", None) == 429:   # 항목 탓이 아니다 — 그대로 둔다
                    failures["429"] += 1
                    in_a_row += 1
                    if in_a_row >= _MAX_429_IN_A_ROW:
                        break
                else:
                    failures["other"] += 1
                    queue.popleft()
            else:
                in_a_row = 0
                queue.popleft()
                refreshed = refresh_proposal(p, detail, fetched_on=fetched_on)
                if refreshed is None:
                    dropped += 1
                else:
                    proposals.append(refreshed)
                    # 새 응답으로는 원문 칸이 비어 저장본 칸을 지킨 것 (refresh_proposal 과 같은 조건)
                    kept += bool(not detail.hours_raw and p.get("opening_hours_raw"))
            total, failed = sum(attempted.values()), sum(failures.values())
            if total >= _MIN_ATTEMPTS and failed * 2 >= total:
                halted = "failure_rate"
                print(f"::warning::상세 되감기 중단 — {total}번 시도에 실패 {failed}건 "
                      f"{dict(failures)}. 망·벤더 장애로 보고 남은 키를 아낀다(남은 대기는 다음 실행).",
                      file=sys.stderr)
                break
    return proposals, {
        "pending": len(pending),
        "attempted": attempted,               # 키(환경변수 이름)별 시도 수
        "emitted": len(proposals),
        "kept_stored_hours": kept,
        "gate_dropped": dropped,              # 표지가 안 붙어 대기로 남는다
        "failures": dict(failures),           # 429 · dead_key · other
        "remaining": len(pending) - len(proposals),
        "halted": halted,                     # deadline · failure_rate · None
    }


def _summary(stats: Mapping) -> str:
    attempted = " · ".join(f"`{k}` {v:,}" for k, v in stats["attempted"].items()) or "—"
    failures = " · ".join(f"{k} {v:,}" for k, v in sorted(stats["failures"].items())) or "0"
    return "\n".join([
        "## 상세 되감기 재조회 (옛 수집분 휴무 원문 채우기)",
        "",
        "| 항목 | 값 |",
        "|---|---|",
        f"| 대기 (실행 전) | {stats['pending']:,} |",
        f"| 시도 (키별) | {attempted} |",
        f"| 다시 낸 제안 | **{stats['emitted']:,}** |",
        f"| 빈 응답이라 저장본 영업시간 유지 | {stats['kept_stored_hours']:,} |",
        f"| 게이트 탈락 (대기로 남음) | {stats['gate_dropped']:,} |",
        f"| 실패 | {failures} |",
        f"| 남은 대기 | {stats['remaining']:,} |",
        f"| 중단 | {stats['halted'] or '—'} |",
        "",
    ])


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pois", type=Path, default=Path("data/collected_pois.json"),
                    help="공유본 — 대기를 여기서 고른다")
    ap.add_argument("--daily", type=Path,
                    help="이번 실행의 일일 산출물 — 여기 실린 content_id 는 건너뛴다(더 새 판이다)")
    ap.add_argument("--out", type=Path, default=Path("rewind_pois.json"), help="산출 등록 제안 문서")
    ap.add_argument("--dry-run", action="store_true", help="대기 건수만 (호출 0, 산출 없음)")
    args = ap.parse_args(argv)

    shared = json.loads(args.pois.read_text(encoding="utf-8"))
    exclude: set[str] = set()
    if args.daily:
        daily = json.loads(args.daily.read_text(encoding="utf-8"))
        exclude = {p["provenance"]["content_id"] for p in daily["proposals"]}
    now = datetime.now(UTC)   # CLI 스크립트만 wall-clock 직접 호출 허용 — 일일 산출물보다 늦다
    today = now.date().isoformat()
    pending = select_pending(shared, closed=load_closed_refs(), exclude=exclude, today=today)
    with_raw = sum(1 for p in pending if p.get("opening_hours_raw"))
    leports = sum(1 for p in pending if not p.get("opening_hours_raw")
                  and p["provenance"]["content_type_id"] == "28")
    kinds = Counter(p["provenance"]["content_type_id"] for p in pending)
    print(f"[rewind] 대기 {len(pending):,}건 — 원문 있음 {with_raw:,} · "
          f"원문 없음 {len(pending) - with_raw - leports:,} · 원문 없는 레포츠 {leports:,} "
          f"(타입별 {dict(sorted(kinds.items()))})")
    if args.dry_run:
        return 0

    logging.basicConfig(level=logging.INFO, format="[rewind] %(levelname)s %(message)s")
    keys = keys_from_env(os.environ)
    if not keys:
        print("[rewind] NOTICE 등록된 키 없음 — 재조회 생략", file=sys.stderr)
    proposals, stats = rewind(pending, keys, UrllibHttpClient(), fetched_on=today)
    args.out.write_text(json.dumps({
        "schema_version": SCHEMA_VERSION,
        "source": SOURCE_NAME,
        "collected_at": now.isoformat(),
        "stats": stats,
        "proposals": proposals,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = _summary(stats)
    print(summary)
    if (path := os.environ.get("GITHUB_STEP_SUMMARY")):
        with open(path, "a", encoding="utf-8") as f:
            f.write(summary + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
