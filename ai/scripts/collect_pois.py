"""TourAPI 일일 수집 — 수집 게이트 통과분을 등록 제안 JSON으로 (TRIP-246, U6-05).

**pytest 대상이 아니다** — CI 실 호출 0건(D37)은 그대로 유지되고, 실 호출은
사람이 손으로 실행하거나 스케줄 워크플로(ai-poi-collect.yml)가 실행할 때만.

산출물은 "등록 제안"일 뿐이다 (INV-1) — POI 정본은 backend C7 단일 소유(PR #76)라
DB에 직접 쓰지 않는다. 백엔드 수신 API 협의 전까지는 GitHub Actions artifact로 보존.

사용법:
    cd ai
    TOUR_API_KEY=<디코딩키> uv run python scripts/collect_pois.py

    # 잡 서머리용 통계 표 (기존 산출 JSON을 읽기만 — 호출 0건)
    uv run python scripts/collect_pois.py --summary collected_pois.json

환경변수 (빈 문자열 = 미설정 취급 — GH Actions는 비운 input을 ''로 주입한다):
    TOUR_API_KEY          필수 — data.go.kr **디코딩** 키 (인코딩은 스크립트가 1회 수행)
    TOUR_API_KEY2         선택 — 두 번째 디코딩 키 (계정별 일일 한도가 독립이라 합산
                          사용). 설정 시 키 1이 키당 상한을 소진하면 키 2로 전환하고
                          수집 시퀀스는 그대로 이어간다 (중복 크롤 0). 미설정이면
                          기존 단일 키 동작과 완전히 동일
    TOURAPI_AREA_CODE     기본 "39" (제주)
    TOURAPI_CONTENT_TYPES 기본 "12,14,39" (관광지·문화시설·음식점, 쉼표 구분)
    TOURAPI_MAX_CALLS     기본 "500" — **키당** 호출 상한 (개발계정 일 1,000의 절반,
                          보수적). 총 예산 = 등록 키 수 × 키당 상한. 총 예산 도달 시
                          그 시점까지 산출하고 정상 종료 (부분 성공 = 성공)
    COLLECT_OUTPUT        기본 "collected_pois.json"

종료 코드: 0 = 게이트 통과 1건 이상 (부분 성공 포함), 1 = 게이트 통과 0건 또는 설정 오류.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from trippilot.poi_curation.sourcing.pipeline import collect, to_output_document
from trippilot.poi_curation.sourcing.tourapi import TourApiAdapter, UrllibHttpClient


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"환경변수 {name} 필요 (사용법: 스크립트 docstring)")
    return value


def _optional(name: str) -> str | None:
    """빈 문자열도 미설정으로 취급 — GH Actions는 비운 input을 ''로 주입한다."""
    return os.environ.get(name) or None


def _print_summary(json_path: str) -> int:
    """산출 JSON → 잡 서머리용 마크다운 표 (GITHUB_STEP_SUMMARY 리다이렉트 용도)."""
    doc = json.loads(Path(json_path).read_text(encoding="utf-8"))
    stats = doc["stats"]
    print("## TourAPI 수집 결과")
    print(f"- 지역 `{doc['area_code']}` · 타입 `{','.join(doc['content_types'])}` · "
          f"수집 시각 {doc['collected_at']}")
    print()
    print("| 항목 | 값 |")
    print("|---|---|")
    print(f"| HTTP 호출 | {stats['http_calls']} |")
    print(f"| 목록 확보 | {stats['listed']} |")
    print(f"| 게이트 통과 (등록 제안) | **{stats['passed']}** |")
    print(f"| 카테고리 매핑 불가 드롭 | {stats['category_unmapped']} |")
    print(f"| 중복 병합 | {stats['merged']} |")
    print(f"| 페이지/상세 실패 | {stats['page_failures']} / {stats['detail_failures']} |")
    print(f"| 한도 도달 조기 종료 | {'예 (부분 성공)' if stats['budget_exhausted'] else '아니오'} |")
    if stats["gate_drops"]:
        print()
        print("| 게이트 드롭 사유 | 건수 |")
        print("|---|---|")
        for reason, count in sorted(stats["gate_drops"].items()):
            print(f"| `{reason}` | {count} |")
    return 0


def main() -> int:
    if len(sys.argv) >= 3 and sys.argv[1] == "--summary":
        return _print_summary(sys.argv[2])

    logging.basicConfig(level=logging.INFO, format="[collect] %(levelname)s %(message)s")
    key = _require("TOUR_API_KEY")
    key2 = _optional("TOUR_API_KEY2")  # 빈 문자열 = 미설정 (키 1개 동작 그대로)
    area_code = _optional("TOURAPI_AREA_CODE") or "39"
    content_types = [
        t.strip() for t in (_optional("TOURAPI_CONTENT_TYPES") or "12,14,39").split(",")
        if t.strip()
    ]
    calls_per_key = int(_optional("TOURAPI_MAX_CALLS") or "500")
    output = _optional("COLLECT_OUTPUT") or "collected_pois.json"

    extra_keys = (key2,) if key2 else ()
    max_calls = calls_per_key * (1 + len(extra_keys))  # 총 예산 = 키 수 × 키당 상한
    adapter = TourApiAdapter(
        UrllibHttpClient(), key,
        extra_keys=extra_keys,
        calls_per_key=calls_per_key if extra_keys else None,
    )
    result = collect(
        adapter,
        area_code=area_code,
        content_types=content_types,
        max_calls=max_calls,
    )
    doc = to_output_document(
        result,
        area_code=area_code,
        content_types=content_types,
        collected_at=datetime.now(UTC),
    )
    Path(output).write_text(
        json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    stats = result.stats
    print(f"[collect] 산출: {output} — 게이트 통과 {stats.passed}건 "
          f"(호출 {stats.http_calls}/{max_calls} [키 {1 + len(extra_keys)}개×키당 "
          f"{calls_per_key}], 목록 {stats.listed}건, "
          f"한도조기종료={stats.budget_exhausted})")
    if stats.passed == 0:
        print("[collect] FAIL 게이트 통과 0건 — 산출물 없음")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
