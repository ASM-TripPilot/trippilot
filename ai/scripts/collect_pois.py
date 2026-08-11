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
                          사용). 설정 시 현재 키가 키당 상한을 소진하면 다음 키로
                          전환하고 수집 시퀀스는 그대로 이어간다 (중복 크롤 0).
                          미설정이면 기존 단일 키 동작과 완전히 동일
    TOUR_API_KEY3         선택 — 세 번째 디코딩 키. 키링에 KEY2 다음 순서로 추가
    TOURAPI_AREA_CODES    쉼표 목록 — 공평 순회할 지역들. 미설정 기본 = 광역 17개
                          전부 (pipeline.DEFAULT_AREA_CODES — 전국 골고루).
                          총 예산을 미완주 지역에 균등 분할, 나머지·조기 종료분은
                          라운드로빈 포인터(상태 저장)에 따라 다음 지역으로 이월
    TOURAPI_AREA_CODE     단수 하위호환 — 설정 시 그 지역만 (TOURAPI_AREA_CODES 무시)
    TOURAPI_CONTENT_TYPES 기본 "12,14,39" (관광지·문화시설·음식점, 쉼표 구분)
    TOURAPI_MAX_CALLS     기본 "500" — **키당** 호출 상한 (개발계정 일 1,000 기준,
                          repo Variables로 1000까지 상향 가능). 총 예산 = 등록 키 수
                          × 키당 상한. 총 예산 도달 시 그 시점까지 산출하고 정상
                          종료 (부분 성공 = 성공)
    COLLECT_OUTPUT        기본 "collected_pois.json"
    COLLECT_STATE         기본 "collect_state.json" — 수집 커서 상태 (TRIP-348).
                          파일이 있으면 로드해 커서 지점부터 재개 + 기제안·변경 없음
                          항목 스킵, 없거나 손상이면 처음부터 + WARNING (우아한 강등).
                          실행 끝에 갱신 상태를 같은 경로에 기록 (전송은 워크플로 소관)

종료 코드: 0 = 게이트 통과 1건 이상 (부분 성공 포함) 또는 스킵만으로 소화된 실행
(기제안·변경 없음 1건 이상 — 새 제안 0건이 정상), 1 = 통과·스킵 모두 0건 또는 설정 오류.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from trippilot.poi_curation.sourcing.pipeline import (
    AREA_NAMES,
    collect_areas,
    resolve_area_codes,
    to_multi_output_document,
)
from trippilot.poi_curation.sourcing.state import load_state, state_to_dict
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
    # 다지역 문서(area_codes)와 과거 단일 지역 문서(area_code) 모두 읽는다
    areas = doc.get("area_codes") or [doc["area_code"]]
    print("## TourAPI 수집 결과")
    print(f"- 지역 `{','.join(areas)}` · 타입 `{','.join(doc['content_types'])}` · "
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
    # TRIP-348 커서 이어가기 — 과거 산출 JSON에는 없을 수 있어 .get으로 읽는다
    print(f"| 스킵 (기제안·변경 없음) | {stats.get('skipped_unchanged', 0)} |")
    resumed = stats.get("resumed_from") or {}
    resumed_txt = ", ".join(f"{k}: p{v}" for k, v in sorted(resumed.items())) or "—"
    print(f"| 재개 지점 | {resumed_txt} |")
    completed = stats.get("completed_kinds") or []
    print(f"| 완주 타입 | {', '.join(completed) or '—'} |")
    per_area = stats.get("per_area") or {}
    if per_area:
        print()
        print("| 지역 | 호출 | 통과 | 스킵 |")
        print("|---|---|---|---|")
        for area, row in per_area.items():  # env 목록 순서 그대로 (결정론)
            label = f"{area} {AREA_NAMES.get(area, '')}".strip()
            print(f"| {label} | {row['calls']} | {row['passed']} | {row['skipped']} |")
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
    # 추가 키 — 빈 문자열 = 미설정 (등록된 것만 순서대로 키링에)
    extra_keys = tuple(
        k for k in (_optional("TOUR_API_KEY2"), _optional("TOUR_API_KEY3")) if k
    )
    area_codes = resolve_area_codes(
        _optional("TOURAPI_AREA_CODE"),    # 단수 하위호환 — 설정 시 그것만
        _optional("TOURAPI_AREA_CODES"),   # 미설정 → 광역 17개 전부 (전국 골고루)
    )
    content_types = [
        t.strip() for t in (_optional("TOURAPI_CONTENT_TYPES") or "12,14,39").split(",")
        if t.strip()
    ]
    calls_per_key = int(_optional("TOURAPI_MAX_CALLS") or "500")
    output = _optional("COLLECT_OUTPUT") or "collected_pois.json"
    state_path = Path(_optional("COLLECT_STATE") or "collect_state.json")

    max_calls = calls_per_key * (1 + len(extra_keys))  # 총 예산 = 키 수 × 키당 상한
    adapter = TourApiAdapter(
        UrllibHttpClient(), key,
        extra_keys=extra_keys,
        calls_per_key=calls_per_key if extra_keys else None,
    )
    result = collect_areas(
        adapter,
        area_codes=area_codes,
        content_types=content_types,
        max_calls=max_calls,
        state=load_state(state_path),   # 없거나 손상 → 빈 상태 + WARNING (state.py)
    )
    collected_at = datetime.now(UTC)    # CLI 스크립트만 wall-clock 직접 호출 허용
    doc = to_multi_output_document(
        result,
        area_codes=area_codes,
        content_types=content_types,
        collected_at=collected_at,
    )
    Path(output).write_text(
        json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    stats = doc["stats"]                # 합산 통계 + per_area (산출 문서와 단일 근원)
    # 갱신 상태 기록 — 파일 I/O는 여기(스크립트), 브랜치 전송은 워크플로 소관 (TRIP-348)
    state_doc = state_to_dict(result.next_state, last_run={
        "at": collected_at.isoformat(),
        "area_codes": area_codes,
        "content_types": content_types,
        "http_calls": stats["http_calls"],
        "passed": stats["passed"],
        "skipped_unchanged": stats["skipped_unchanged"],
        "per_area": stats["per_area"],
    })
    state_path.write_text(
        json.dumps(state_doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[collect] 산출: {output} — 게이트 통과 {stats['passed']}건 "
          f"(지역 {len(area_codes)}곳, 호출 {stats['http_calls']}/{max_calls} "
          f"[키 {1 + len(extra_keys)}개×키당 {calls_per_key}], "
          f"목록 {stats['listed']}건, 스킵 {stats['skipped_unchanged']}건, "
          f"한도조기종료={stats['budget_exhausted']}) · 상태: {state_path}")
    if stats["passed"] == 0 and stats["skipped_unchanged"] == 0:
        print("[collect] FAIL 게이트 통과 0건 — 산출물 없음")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
