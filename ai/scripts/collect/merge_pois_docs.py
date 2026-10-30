"""수집 산출물(등록 제안 JSON) 여러 개 → 합본 문서 하나 (팀 공유본 갱신용).

`ai-poi-collect` 는 **실행 한 번 분량**만 artifact 로 남기고(보존 30일), 누적본을
어디에도 두지 않는다. 팀 공유본(`ai/data/collected_pois.json`)을 최신 실행 하나로
갈아끼우면 앞선 실행에서만 나온 POI 가 조용히 사라진다 — 그래서 합친다.

사용법:
    cd ai
    gh run download <RUN_ID> -n collected-pois -D /tmp/poi/<RUN_ID>   # 여러 실행 반복
    uv run python scripts/collect/merge_pois_docs.py -o data/collected_pois.json /tmp/poi/*/collected_pois.json

같은 content_id 는 **나중 수집분이 이긴다**(재제안 = 변경 감지분). 재실행해도 결과가
같다(멱등). stats 는 합치지 않는다 — 실행별 수치(per_area·gate_drops)를 더하면 의미가
뭉개지므로 실행별 원문을 `merged_from` 에 그대로 남기고, 합본에 대해 참인 것만 `stats`
에 둔다. 스키마 정본은 `poi_curation/sourcing/pipeline.py` 의 `to_output_document`.
"""

from __future__ import annotations

import argparse
import contextlib
import copy
import io
import json
import re
import sys
from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from collect_localdata import _MIGRATION, load_regions  # noqa: E402  (같은 디렉토리)
from collect_pois import load_closed_refs  # noqa: E402  (같은 디렉토리)
from trippilot.domain.poi import TRENDING_TAG  # noqa: E402
from trippilot.poi_curation.sourcing.mapping import (  # noqa: E402
    non_travel_reason,
    parse_opening_hours_raw,
)
from trippilot.poi_curation.sourcing.overture_address import expand_sido, sido_abbreviations  # noqa: E402
from trippilot.poi_curation.sourcing.state import parse_state  # noqa: E402
from trippilot.poi_curation.sourcing.overture import (  # noqa: E402
    NIGHTLIFE_DETAIL,
    NIGHTLIFE_TAG,
    nightlife_tags,
)


_POI_DEFAULTS = {"avg_cost": None, "rating": None, "confidence": None, "source_ref": None,
                 "saved_count": 0, "tags": []}


def _slim(p: dict) -> dict:
    poi = p.get("poi")
    if not isinstance(poi, dict):
        return p
    return {**p, "poi": {k: v for k, v in poi.items() if k not in _POI_DEFAULTS or v != _POI_DEFAULTS[k]}}


def dumps_doc(doc: dict) -> str:
    """공유본 직렬화 — 머리는 들여쓰기, **제안은 한 행에 한 줄**(압축 JSON).

    들여쓰기 2칸이면 72MB 였다(2026-10-18, 57,608행). GitHub 는 한 파일 100MB 를 거부하는데,
    TourAPI 조회를 법정동 코드로 바꾸면 관광지가 지역별 1.7~2.9배로 늘어(같은 날 실측) 그 선을 넘는다.
    한 행에 한 줄이면 46MB 이고 diff 는 여전히 행 단위로 읽힌다. 읽는 쪽은 전부 `json.load` 라 무관하다.

    **`poi` 의 기본값 키는 싣지 않는다**(`_POI_DEFAULTS`) — 2026-10-30 116,855행에서 103.2MB 가 돼 다시
    100MiB 에 하루치만 남았다. 값이 늘 null·0·빈 목록인 칸이 10.7MB 였다. 백엔드 수신 DTO 는 그 칸을
    읽지 않고(`ProposalPoi` = name·category·coord), 우리 쪽은 `Poi.from_dict` 가 없는 키를 기본값으로 읽는다.
    """
    head = {k: v for k, v in doc.items() if k != "proposals"}
    rows = ",\n".join("    " + json.dumps(_slim(p), ensure_ascii=False, separators=(",", ":"))
                      for p in doc.get("proposals", ()))
    return (json.dumps(head, ensure_ascii=False, indent=2)[:-2]
            + ',\n  "proposals": [\n' + rows + "\n  ]\n}\n")


def merge(docs: list[dict], *, allow_mixed: bool = False) -> dict:
    """수집 시각 순으로 합친다 — 나중 문서가 같은 content_id 를 덮어쓴다.

    **출처가 다르면 `allow_mixed` 없이는 거부한다.** 이 도구는 원래 같은 출처의 실행
    artifact 를 합치려고 만든 것인데, 교차 출처(TourAPI + LOCALDATA)로도 아무 말 없이
    합쳐 줬다. 그러면 최상위 `source` 를 `collected_at` 이 늦은 쪽이 가져가는데, 수신 계약
    `PoiProposalDocument` 은 **문서 레벨 source 하나만** 읽고(`ProposalItem` 에 source 칸이
    없다) 유일키가 (source, content_id) 라 — 늦은 쪽 출처로 **전량이 한 벌 더** 들어간다.
    2026-10-14 실측: 19,079 + 22,283 을 합쳤더니 최상위가 LOCALDATA 가 돼, 그대로 부었으면
    TourAPI 19,079곳이 LOCALDATA 출처 새 행으로 중복될 뻔했다(배포 전 발견).
    """
    # 문서 레벨만 보면 **이미 섞인 문서 하나**를 다시 병합할 때 표식이 사라진다
    # (공유본 재병합은 폐업 소급 제거 때 실제로 한다). 항목 출처가 정본이므로 같이 본다.
    sources = {d.get("source") for d in docs} | {
        p.get("source") for d in docs for p in d["proposals"] if p.get("source")
    }
    sources.discard(None)
    if len(sources) > 1 and not allow_mixed:
        raise SystemExit(
            f"[merge] 출처가 섞였습니다: {sorted(s or '?' for s in sources)}\n"
            "  문서 레벨 source 는 하나뿐이고 수신이 그것만 읽습니다 — 합치면 늦은 쪽 출처로\n"
            "  전량이 중복 적재됩니다. 일부러 섞으려면 --allow-mixed 를 주세요. 그러면 문서에\n"
            "  `sources` 를 적어 두므로, 소비자가 항목별 source 로 갈라 보내야 합니다."
        )
    by_ref = versions_by_ref(docs)
    docs = sorted(docs, key=lambda d: d["collected_at"])
    # 키는 **(출처, content_id)** 다 — 백엔드 유일키와 같은 모양이다. `content_id` 만으로
    # 잡으면 다른 출처의 같은 번호가 서로를 덮고, 그 행이 `--close-missing` 에서 "목록 부재"로
    # 읽혀 **살아 있는 POI 가 퇴출된다.** `load_closed_refs`·`drop_closed` 가 이미 같은 이유로
    # 출처를 붙여 키를 잡고 있었는데(그 주석 참조) 병합만 빠져 있었다.
    #
    # 지금 세 출처는 번호 꼴이 겹치지 않아(TOURAPI 숫자 `1000981` · LOCALDATA 관리번호
    # `3000000-101-1967-03256` · OVERTURE UUID) 실측 충돌 0·유실 0 이다. 네 번째 출처가
    # 숫자나 UUID 를 쓰면 그때 조용히 깨지므로 미리 막는다 (ai-e3 리뷰, 2026-10-15).
    areas: list[str] = []
    types: list[str] = []
    for d in docs:
        for a in d.get("area_codes") or [d.get("area_code")]:
            if a and a not in areas:
                areas.append(a)
        for t in d.get("content_types", []):
            if t not in types:
                types.append(t)
    proposals = {ref: vs[-1] for ref, vs in by_ref.items()}
    # 공공누리 유형(cpyrhtDivCd, `Type1`·`Type3`…) — 수집 실행은 목록에서 **본** 행 전부의 값을 따로 싣는다
    # (변경 없음으로 상세를 건너뛴 행 포함). 그래서 이미 있는 행도 지역 순회가 한 바퀴 돌면 채워진다
    # (KB-5 장소 지식 요청, 2026-10-30 — 변경금지 Type3 를 따로 다룰지 판단할 근거).
    cpyrht = 0
    for d in docs:
        for cid, v in (d.get("cpyrht_by_ref") or {}).items():
            if (p := proposals.get(("TOURAPI", cid))) is not None:
                p["provenance"]["cpyrht_div_cd"] = v
                cpyrht += 1
    return {
        "schema_version": docs[-1]["schema_version"],
        # 섞였으면 **항목별 source 가 정본**이다 — 최상위 하나만 읽으면 틀린다는 것을
        # 문서가 스스로 드러내게 `sources` 를 같이 적는다(수신 DTO 는 ignoreUnknown).
        "source": docs[-1]["source"],
        **({"sources": sorted(sources)} if len(sources) > 1 else {}),
        "collected_at": docs[-1]["collected_at"],
        "area_codes": sorted(areas, key=int),
        "content_types": sorted(types, key=int),
        # cpyrht_applied: 이번 병합이 공공누리 유형을 붙인 행 수 — 0 이 이어지면 목록 응답에 그 칸이 없는 것이다
        "stats": {"merged_runs": len(docs), "unique_proposals": len(proposals), "cpyrht_applied": cpyrht},
        "merged_from": [
            {
                "collected_at": d["collected_at"],
                "proposals": len(d["proposals"]),
                "stats": d.get("stats", {}),
            }
            for d in docs
        ],
        "proposals": list(proposals.values()),
    }


def reparse_open_hours(proposals: list[dict]) -> int:
    """`open_hours` 가 비었는데 원문이 있는 제안을 **현재 파서로 다시** 읽는다.

    파서를 고쳐도 이미 수집된 것에는 소급되지 않는다 — 증분 색인이 "변경 없음"으로
    스킵해 상세를 다시 안 받고, 받아도 파싱은 수집 시점에 한 번뿐이다. 그래서
    `상시 개방` 을 종일로 읽게 고친(PR #280) 뒤에도 공유본엔 그게 결측으로 남아
    있었다. 2026-09-17 실측: 결측 15,859건 중 **2,490건**이 원문만 있고 파싱이
    비어 있었고, 현재 파서로 전부 살아난다 — HC1 사각 85.2% → 71.8%.

    외부 호출 0. 원문(`opening_hours_raw`)이 정본이고 `open_hours` 는 그 파생이라,
    파생을 최신 규칙으로 다시 내는 것은 데이터를 바꾸는 게 아니다. 이미 값이
    있으면 건드리지 않는다 — 수집 시점 판정을 병합이 뒤집지 않는다.

    원문 칸에 휴무가 함께 실려 있으면 갈라서 읽는다(TRIP-1226). 종전에는 휴무 없이
    읽어서, 여기서 채운 6,055건(#729·#740)은 휴무가 빠진 채 굳었다 — 공유본에 휴무
    원문이 없어 재수집 없이는 못 되살린다(`backfill_rest_days.py` 는 수집 때 파싱분만 되살린다).
    """
    n = 0
    for p in proposals:
        poi = p.get("poi") or {}
        raw = p.get("opening_hours_raw")
        if poi.get("open_hours") or not raw:
            continue
        hours = parse_opening_hours_raw(raw)
        if hours:
            poi["open_hours"] = [asdict(h) for h in hours]
            n += 1
    return n


def drop_non_travel(proposals: list[dict]) -> dict[str, int]:
    """관광 무관으로 **지금 판정되는** 제안을 뺀다. 사유별 건수를 돌려준다.

    수집 게이트 5단이 이미 같은 판정을 하지만 **수집 시점에만** 한다. 규칙을 고쳐도
    이미 수집된 것에는 소급되지 않고, 병합은 게이트를 타지 않는다 — 실측(2026-09-26):
    공유본 18,607건에 현재 규칙으로 걸리는 것이 2건 남아 있었다(`이마트24 강릉여고점`).
    규칙이 09-16 에 들어왔는데 공유본은 09-13 수집분이라 그렇다.

    영업시간 재파싱(`reparse_open_hours`)과 **같은 자리·같은 이유**다: 판정 규칙을
    고치면 다음 병합에서 기존 수집분에 소급된다. 외부 호출 0.

    ⚠️ 이 검사는 **이름만** 본다(`_NON_TRAVEL` — 오탐 0 을 실데이터로 확인한 좁은
    규칙). 카테고리 화이트리스트는 벤더 원 분류가 필요해 제안 문서에 없으므로 여기서
    못 한다 — 그건 수집 게이트의 몫이고, Overture·OSM 이 합류할 때 거기서 걸린다.
    """
    kept: list[dict] = []
    dropped: dict[str, int] = {}
    for p in proposals:
        name = (p.get("poi") or {}).get("name") or ""
        if (reason := non_travel_reason(name, (p.get("poi") or {}).get("category"))) is not None:
            dropped[reason] = dropped.get(reason, 0) + 1
            continue
        kept.append(p)
    proposals[:] = kept
    return dropped


_VERDICTS = Path(__file__).resolve().parents[2] / "data" / "overture_nonfood_verdicts.json"
def _ref(p: dict, d: dict) -> tuple[str, str]:
    # 항목 source 가 정본이고, 없으면 문서 source — 수신도 그 순서로 읽는다
    return str(p.get("source") or d.get("source") or "").upper(), p["provenance"]["content_id"]


def versions_by_ref(docs: list[dict]) -> dict[tuple[str, str], list[dict]]:
    """같은 행의 판본들을 수집 시각 순으로 모은다 — 마지막 판본이 `merge` 가 고르는 것(같은 객체)이다."""
    out: dict[tuple[str, str], list[dict]] = {}
    for d in sorted(docs, key=lambda d: d["collected_at"]):
        for p in d["proposals"]:
            out.setdefault(_ref(p, d), []).append(p)
    return out


_TRENDING = Path(__file__).resolve().parents[2] / "data" / "curated_trending_refs.json"


def expand_sido_abbrev(proposals: list[dict], abbrev: dict[str, str] | None = None) -> int:
    """주소 첫 낱말이 시도 **약칭**이면 정식 이름으로 편다. 고친 건수를 돌려준다.

    백엔드 `RegionResolver` 는 주소 첫 낱말이 카탈로그의 시도 이름과 **정확히** 같아야 지역 코드를
    붙인다. TourAPI 는 일부 주소를 약칭으로 준다 — 법정동 목록으로 바꾼 첫 수집(#1352)에서
    `강원 속초시 …`·`충북 단양군 …` 3건이 들어와 백엔드 실문서 IT(`regionUnresolved == 0`)가 깨졌다.
    약칭 표는 카탈로그에서 유도한다(`sido_abbreviations` — Overture 주소 복원과 같은 표).
    """
    abbrev = abbrev if abbrev is not None else sido_abbreviations(
        load_regions(_MIGRATION / "R__seed_region_catalog.sql"))
    n = 0
    for p in proposals:
        prov = p.get("provenance") or {}
        addr = prov.get("address")
        if addr and (full := expand_sido(addr, abbrev)) != addr:
            prov["address"] = full
            n += 1
    return n


# 백엔드 `RegionResolver.resolve`(backend/modules/place-data/src/main/kotlin/com/trippilot/placedata/domain/RegionResolver.kt:21-24)
# 의 첫 토큰을 그대로 흉내 낸다 — `address?.trim()?.split(Regex("\\s+"))?.filter { it.isNotBlank() }` 의 첫째가
# 카탈로그 시도 이름과 같아야 지역 코드가 붙는다. Python `str.split()` 은 NBSP·U+3000 도 나눠 백엔드보다 느슨하다.
# Kotlin `trim()`·`isNotBlank()` 의 공백(`Char.isWhitespace` = JVM `isWhitespace || isSpaceChar`)은 Python `isspace` 에서
# U+0085(NEL) 하나만 뺀 집합이고, `Regex("\\s+")` 는 플래그 없는 Java `\s` 라 ASCII 공백 6자만 나눈다
# (둘 다 JDK 25 jshell 로 BMP 전수 대조, TRIP-1475).
_KT_WHITESPACE = "".join(c for c in map(chr, range(0x10000)) if c.isspace() and c != "\x85")
_JAVA_WS = re.compile(r"[ \t\n\x0b\f\r]+")
# 격리 상한(격리 + 앞 판본 복원 합) — 관측한 나쁜 행은 한 번에 2~3건이었다(#1352 약칭 3 · #1427 잘림 2). 20건을 넘으면 행 몇 개의 결함이
# 아니라 카탈로그·주소 형식이 통째로 바뀐 사고로 본다 — 그때는 조용히 빼지 않고 병합을 멈춘다. 복원도 세는 이유:
# 형식이 통째로 바뀌면 행은 앞 판본으로 살아남아도 그만큼 기제안 색인이 한꺼번에 지워진다(조용히 재수집 폭증).
MAX_QUARANTINED = 20


def backend_sido_token(address: str | None) -> str | None:
    """백엔드가 시도 이름으로 대조하는 주소 첫 토큰. 백엔드가 미판정(null)으로 끝내는 주소(없음·공백뿐)는 None."""
    tokens = [t for t in _JAVA_WS.split((address or "").strip(_KT_WHITESPACE)) if t.strip(_KT_WHITESPACE)]
    return tokens[0] if tokens else None


def _load_sido() -> set[str]:
    return {n for _, n, _, lvl, _ in load_regions(_MIGRATION / "R__seed_region_catalog.sql") if lvl == "SIDO"}


def _resolves(p: dict, sido: set[str]) -> bool:
    return backend_sido_token((p.get("provenance") or {}).get("address")) in sido


def _ref_dict(ref: tuple[str, str], p: dict) -> dict:
    return {"source": ref[0], "content_id": ref[1], "address": (p.get("provenance") or {}).get("address")}


def unresolved_sido(proposals: list[dict], sido: set[str] | None = None,
                    history: dict[tuple[str, str], list[dict]] | None = None) -> list[dict]:
    """백엔드가 시도를 못 정할 제안의 `{source, content_id, address}` — 빼지 않고 세기만 한다(`--state` 없는 병합)."""
    sido = sido if sido is not None else _load_sido()
    ref_of = {id(vs[-1]): r for r, vs in (history or {}).items()}
    return [_ref_dict(ref_of.get(id(p)) or _ref(p, {}), p) for p in proposals if not _resolves(p, sido)]


def quarantine_unresolved_sido(proposals: list[dict], sido: set[str] | None = None,
                               history: dict[tuple[str, str], list[dict]] | None = None,
                               before_refs: frozenset[tuple[str, str]] = frozenset(),
                               survives: Callable[[dict], bool] = lambda _: True,
                               ) -> tuple[list[dict], list[dict], list[dict]]:
    """백엔드가 시도를 못 정할 제안을 가른다. `(격리, 직전 판본 복원, 남겨 둠)` 을 각각 `{source, content_id, address}` 로.

    공유본 봇 PR 은 체크 0 으로 즉시 머지돼(#1427: 6초) 백엔드 실문서 IT(`regionUnresolved == 0`)가 머지 **뒤**에야
    돈다 — #1352·#1427 이 그렇게 develop backend-ci 를 깼다. 그래서 병합이 같은 판정을 먼저 한다. 약칭 펴기
    (`expand_sido_abbrev`) **뒤**에 둬야 펼 수 있는 행을 살린다. 전부-아니면-전무로 막지 않는다 — 한두 행 때문에 그날
    수집분 전체를 버리지 않게 그 행만 빼고, 건수가 `MAX_QUARANTINED` 를 넘을 때만 `main` 이 실패시킨다.

    **앞선 입력 문서에 게이트를 통과하는 판본이 있으면 빼지 않고 그 판본으로 되돌린다.** 벤더가 살아 있는 행을
    깨진 주소로 다시 보내면 `merge` 가 좋은 판본을 덮는다 — 그 키를 통째로 빼면 공유본에서 POI 가 사라지고,
    `--close-missing` 이 그 부재를 퇴출로 읽어 **살아 있는 POI 를 닫는다**(백엔드는 시도 없는 행도 받아 둔다 —
    `PoiProposalIngestService`). `history`(`versions_by_ref`) 의 앞 판본은 호출자가 약칭을 펴 둔 것이어야 한다.
    되돌릴 판본은 게이트만이 아니라 **소급 제거도 통과**(`survives`)해야 한다 — 옛 판본만 걸리는 규칙(옛 이름이 관광
    무관 …)이 있으면 되돌린 뒤 그 키가 통째로 빠져, 지키려던 POI 가 결국 닫힌다. 그런 판본밖에 없으면 되돌리지 않고
    아래 "남겨 둠"으로 간다 — 벤더가 지금 내보내는 오늘 판본을 경고와 함께 둔다.

    **통과하는 판본이 없어도 공유본(`before_refs`)에 있던 키면 빼지 않는다(남겨 둠 — 최종 판본 그대로).** 경고만 하던
    기간·수동 병합으로 이미 미판정인 채 들어와 있던 행이다. 빼면 공유본에서 사라져 `--close-missing` 이 살아 있는
    POI 를 닫고, LOCALDATA·OVERTURE·KAKAO_LOCAL 은 다시 수집되지 않아 영영 안 돌아온다. 상한에도 세지 않는다(매일
    같은 행으로 막히지 않게). 그래서 격리되는 것은 **공유본에 없던 키**(그날 처음 온 행)뿐이다.
    출처는 `merge` 와 같은 규칙(항목 source → 문서 source)으로 `history` 에서 읽는다 — 없으면 항목 source 만.
    """
    sido = sido if sido is not None else _load_sido()
    history = history or {}
    ref_of = {id(vs[-1]): r for r, vs in history.items()}
    kept: list[dict] = []
    out: list[dict] = []
    restored: list[dict] = []
    left: list[dict] = []
    for p in proposals:
        if _resolves(p, sido):
            kept.append(p)
            continue
        ref = ref_of.get(id(p)) or _ref(p, {})
        prev = next((v for v in reversed(history.get(ref, [])[:-1]) if _resolves(v, sido) and survives(v)), None)
        if prev is not None:
            restored.append(_ref_dict(ref, p))
            kept.append(prev)
        elif ref in before_refs:
            left.append(_ref_dict(ref, p))
            kept.append(p)
        else:
            out.append(_ref_dict(ref, p))
    proposals[:] = kept
    return out, restored, left


def forget_quarantined(state_path: Path, refs: list[dict]) -> int:
    """격리·복원한 TourAPI 제안을 수집 상태의 기제안 색인(`proposed`)에서 지운다. 지운 건수를 돌려준다.

    색인에 남으면 그 행은 벤더가 `modifiedtime` 을 바꿀 때까지 "변경 없음"으로 건너뛰어 다시 오지 않는다(영구 유실).
    지워도 **다음 실행이 바로 다시 받지는 않는다** — 커서가 이미 그 페이지를 지났다(`pipeline.collect` 는
    완주 전엔 `next_page` 부터 잇는다). 그 (지역, 타입)을 완주한 뒤 처음부터 다시 훑을 때 받고, 그사이 펴는 규칙이
    고쳐졌으면 그때 들어간다. 색인은 TourAPI 수집만 쓴다.
    """
    ids = {q["content_id"] for q in refs if str(q.get("source") or "").upper() == "TOURAPI"}
    doc = json.loads(state_path.read_text(encoding="utf-8"))
    proposed = doc.get("proposed") or {}
    gone = ids & proposed.keys()
    if gone:
        doc["proposed"] = {k: v for k, v in proposed.items() if k not in gone}
        state_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(gone)


def mark_trending(proposals: list[dict], path: Path = _TRENDING) -> int:
    """웹 큐레이션이 "이미 있음"으로 맞춘 **기존 행**에 `요즘 인기` 태그를 붙인다. 붙인 건수를 돌려준다.

    유명한 곳은 대개 TourAPI 에 이미 있어 큐레이션이 새 행을 못 만든다 — 그 행에 표지를 붙여야
    인기 가산(`scorer._popularity_norm`)이 닿는다. 병합마다 소급하는 이유는 `drop_closed` 와 같다:
    TourAPI 매일 재수집이 같은 키를 덮어 태그를 지운다. 근거는 `collect_curated_kakao.py` 가 쓰는
    파일이고, 없거나 깨지면 0(판정 파일과 같은 규약).
    """
    if not path.exists():
        return 0
    try:
        refs = {(r["source"], r["content_id"])
                for r in json.loads(path.read_text(encoding="utf-8"))["refs"]}
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as e:   # noqa: BLE001
        print(f"[merge] WARNING 인기 표지 파일을 못 읽었다({type(e).__name__})", file=sys.stderr)
        return 0
    n = 0
    for p in proposals:
        tags = p.get("tags") or []
        if (p.get("source"), p["provenance"]["content_id"]) in refs and TRENDING_TAG not in tags:
            p["tags"] = [*tags, TRENDING_TAG]
            n += 1
    return n


def drop_rejected_verdicts(proposals: list[dict],
                           path: Path = _VERDICTS) -> int:
    """LLM 판정이 **reject** 인 제안을 뺀다. 지운 건수를 돌려준다.

    불변식: **공유본에는 reject 판정을 받은 행이 없다.** 판정 기준을 조이면(프롬프트 판본이
    올라가면) 이미 들어간 행에도 소급돼야 하는데, 종전에는 수집 시점에만 걸러서 적재된 뒤에는
    손으로 지워야 했다 — 그러면 다음 수집에 다시 들어온다.

    `drop_non_travel`·`drop_bad_nightlife` 와 같은 자리·같은 이유의 소급이다. 다만 이쪽은
    규칙이 아니라 **판정 파일**이 근거다(`overture_nonfood_verdicts.json`, 항목마다 `prompt`
    판본과 사유가 적혀 있다). 파일이 없으면 0 — 판정이 없으면 판정하지 않는 것이 맞다.

    `accept` 와 **미판정은 건드리지 않는다.** 미판정을 빼면 판정 대상이 아니었던 TourAPI·
    LOCALDATA 행까지 사라진다 — 이 파일은 Overture 비식당만 담는다.
    """
    if not path.exists():
        return 0
    try:
        verdicts = json.loads(path.read_text(encoding="utf-8")).get("verdicts") or {}
    except (OSError, json.JSONDecodeError) as e:                      # noqa: BLE001
        print(f"[merge] WARNING 판정 파일을 못 읽었다({type(e).__name__})", file=sys.stderr)
        return 0
    rejected = {ref for ref, v in verdicts.items() if v.get("verdict") == "reject"}
    if not rejected:
        return 0
    kept = [p for p in proposals
            if p["provenance"]["content_id"] not in rejected]
    n = len(proposals) - len(kept)
    proposals[:] = kept
    return n


def drop_bad_nightlife(proposals: list[dict]) -> int:
    """나이트라이프 규칙이 **지금** 거르는 제안을 뺀다. 지운 건수를 돌려준다.

    `drop_non_travel` 과 같은 자리·같은 이유의 소급이다. 나이트라이프 규칙은 수집 시점에만
    돌아서, 규칙을 조여도 이미 들어간 행에는 소급되지 않는다 — 실측(2026-10-15): 사교댄스
    강습소 4곳(`보니따 살사클럽`·`Luz Tango`·`살사&바차타 댄스 클럽`·`강남홍대 스카이라틴`)과
    7080 체인 1곳(`밤과음악사이`)이 `클럽` 으로 들어가 있었다. 사용자가 품질을 지적한 건이다.

    원천 카테고리(`kind`)는 제안에 없다 — `tags` 가 나이트라이프 태그로 바뀌어 있다. 그래서
    **세부 태그에서 되찾는다**(`클럽` → `dance_club`). 세부는 `NIGHTLIFE_DETAIL` 의 값이고
    1:1 이므로 역인덱스가 유일하다.

    **클럽은 웹 큐레이션(`KAKAO_LOCAL`, `collect_curated_kakao.py`) 것만 남긴다**(2026-10-18).
    Overture 클럽은 판정 v4 뒤에도 사용자가 품질을 지적했고, 별점·리뷰 수는 카카오·네이버
    API 어디에도 없어 "많이 가는 곳"을 데이터로 가를 수 없다 — 사람이 웹에서 고른 목록이 대역이다.
    """
    by_detail = {v: k for k, v in NIGHTLIFE_DETAIL.items()}
    kept: list[dict] = []
    for p in proposals:
        tags = p.get("tags") or []
        kind = by_detail.get(tags[1]) if (len(tags) >= 2 and tags[0] == NIGHTLIFE_TAG) else None
        if kind is not None and nightlife_tags(kind, p["poi"]["name"]) is None:
            continue
        if kind == "dance_club" and p.get("source") != "KAKAO_LOCAL":
            continue
        kept.append(p)
    n = len(proposals) - len(kept)
    proposals[:] = kept
    return n


# 1박 숙영지 이름. 어휘는 요금 수집의 1박 표지(`collect_place_fees._OVERNIGHT`)에서 `휴양림` 만 뺐다 — 요금으로는
# 휴양림 요금이 대개 숙박비라 맞지만, 장소로는 자연휴양림이 낮 방문지다(관광지 cat3 A01010600 은 NATURE). 공유본
# 레포츠에서 `휴양림` 으로만 걸리는 9곳에 `영인산자연휴양림 스카이어드벤처 (영인산 짚라인)` 과 일일 개장
# 09:00~18:00 휴양림 둘이 있었다(2026-10-30 — 걸린 1,633곳 중 `캠핑장`·`야영장`·`글램핑` 꼴이 아닌 107곳과 다른
# 업종 낱말이 섞인 이름을 눈으로 봤다).
_CAMPING = re.compile(r"캠핑|야영|글램핑|오토캠|카라반|펜션|민박")
# 한 상호에 두 곳이 묶인 표기는 전부 숙영지일 때만 뺀다(`mapping.is_franchise` 와 같은 구분자) — `노랑카라반&고카트` 의
# 고카트(10:00~19:30)는 낮 방문지다. 한 글자 조각은 상호의 일부라 안 본다(`A&J오토캠핑장`).
_JOINED = re.compile(r"[&,]")


def _is_camping(p: dict) -> bool:
    poi = p.get("poi") or {}
    parts = [s for s in (x.strip() for x in _JOINED.split(poi.get("name") or "")) if len(s) > 1]
    return (p.get("source") == "TOURAPI" and (p.get("provenance") or {}).get("content_type_id") == "28"
            and poi.get("category") == "ACTIVITY" and bool(parts) and all(_CAMPING.search(s) for s in parts))


def drop_camping(proposals: list[dict]) -> int:
    """레포츠(TourAPI 28)로 들어온 캠핑장·야영장·글램핑·펜션을 뺀다. 지운 건수를 돌려준다.

    수집은 cat3 야영장을 드롭하지만(`mapping.map_category`) **수집 시점에만** 한다 — 제안 문서에 벤더 분류 코드가
    남지 않아 이미 들어간 행은 이름으로만 가를 수 있고, cat 이 빈 새 분류 항목은 수집도 못 거른다.
    `drop_non_travel` 과 같은 자리·같은 이유의 소급이다. 외부 호출 0.

    **출처·타입·카테고리를 다 본다** — 이름만 보면 LOCALDATA 의 캠핑장 안 식당(시설 이름으로 인허가를 낸다 —
    `collection_gate` 3단 주석)·음식점 `캠핑7`·쇼핑 `고릴라캠핑 송도점`·문화시설 `잉카마야박물관&캠핑장` 이 빠진다.
    비여행지 사유(`non_travel_reason`)에 넣지 않는 이유도 같다 — 그쪽은 모든 출처의 수집 게이트가 쓰고, 국립공원
    야영장을 그 규칙의 생존자로 고정해 둔다(`test_non_travel_gate`).
    """
    kept = [p for p in proposals if not _is_camping(p)]
    n = len(proposals) - len(kept)
    proposals[:] = kept
    return n


def drop_closed(proposals: list[dict], closed_refs: frozenset[tuple[str, str]]) -> int:
    """폐업 확인된 제안을 뺀다. 지운 건수를 돌려준다.

    수집 게이트 2단이 `closed_refs` 로 같은 판정을 하지만 **수집 시점에만** 한다 —
    근거 파일(2026-09-08)보다 먼저 수집된 것은 색인이 "변경 없음"으로 스킵해 게이트를
    다시 타지 않는다. 실측(2026-10-05): 공유본 18,605건에 CLOSED 210건(FOOD 134·CAFE 76)이
    그대로 있었다. `drop_non_travel` 과 **같은 자리·같은 이유**의 소급이다. 외부 호출 0.

    조회 키는 게이트와 같은 `(출처, 벤더 번호)` 다 — 번호는 출처 안에서만 유일하므로
    (`SourcingCandidate.ref`) 다른 출처의 같은 번호는 건드리지 않는다.
    """
    if not closed_refs:
        return 0
    kept = [p for p in proposals
            if (str(p.get("source") or "").lower(), p["provenance"]["content_id"]) not in closed_refs]
    n = len(proposals) - len(kept)
    proposals[:] = kept
    return n


def _self_check() -> None:
    """덮어쓰기 방향 — 나중 수집분이 이긴다."""
    def doc(at, name):
        return {
            "schema_version": 1, "source": "TOURAPI", "collected_at": at,
            "area_code": "1", "content_types": ["12"], "stats": {},
            "proposals": [{"provenance": {"content_id": "x"}, "poi": {"name": name}}],
        }
    out = merge([doc("2026-08-02T00:00:00+00:00", "새것"), doc("2026-08-01T00:00:00+00:00", "옛것")])
    assert out["proposals"][0]["poi"]["name"] == "새것", out
    assert out["stats"] == {"merged_runs": 2, "unique_proposals": 1}, out
    print("[merge] self-check 통과")


def _survives_retro_drops(p: dict) -> bool:
    """이 판본 하나가 소급 제거를 통과하는가 — 되돌릴 후보 판정용. **순수 판정이다**: 사본으로 보고(재파싱이 원본을
    고치지 않게), 판정 로그는 삼킨다(실제로 뺀 게 아니다). 되돌린 판본의 재파싱은 `main` 이 따로 한다."""
    probe = {"proposals": [copy.deepcopy(p)], "stats": {}}
    with contextlib.redirect_stderr(io.StringIO()):
        retro_drops(probe)
    return bool(probe["proposals"])


def retro_drops(out: dict, ref_by_id: dict[int, tuple[str, str]] | None = None,
                before_refs: frozenset[tuple[str, str]] = frozenset()) -> None:
    """영업시간 재파싱 + 소급 제거들. stats 는 더한다(되돌릴 후보 판정 `_survives_retro_drops` 도 이걸 쓴다).

    `retro_dropped_existing` — 뺀 행 중 **공유본(BEFORE)에 있던 키**만 센 수. 축소 가드는 공유본과 비교하므로 이것만
    빼 준다 — 그날 처음 온 행의 제거까지 더하면 가드가 그만큼 느슨해진다(종류별 `*_dropped` 는 전체 수)."""
    start = {id(p) for p in out["proposals"]}
    recovered = reparse_open_hours(out["proposals"])
    if recovered:
        print(f"[merge] 영업시간 재파싱 — {recovered}건 살림 (원문은 있었는데 파싱이 비어 있던 것)",
              file=sys.stderr)
    # 관광 무관 소급 제거 — 규칙이 수집 뒤에 들어왔거나 고쳐졌으면 여기서 걸린다.
    if (dropped := drop_non_travel(out["proposals"])):
        detail = " · ".join(f"{k} {v}" for k, v in sorted(dropped.items()))
        print(f"[merge] 관광 무관 제거 — {sum(dropped.values())}건 ({detail})", file=sys.stderr)
        out["stats"]["unique_proposals"] = len(out["proposals"])
        # **축소 가드가 이걸 사고로 오인하지 않게 stats 에 남긴다.** 배치는
        # "합본 < 공유본이면 실패"로 조용한 유실을 막는데, 의도한 제거도 수를
        # 줄이므로 그 값을 빼고 비교해야 한다. 안 남기면 내일 배치가 빨개진다.
        out["stats"]["non_travel_dropped"] = out["stats"].get("non_travel_dropped", 0) + sum(dropped.values())
    # 나이트라이프 규칙 소급 — 위 `drop_non_travel` 과 같은 규약(축소를 stats 에 남긴다).
    if (bad_night := drop_bad_nightlife(out["proposals"])):
        print(f"[merge] 나이트라이프 규칙 제거 — {bad_night}건", file=sys.stderr)
        out["stats"]["unique_proposals"] = len(out["proposals"])
        out["stats"]["bad_nightlife_dropped"] = out["stats"].get("bad_nightlife_dropped", 0) + bad_night
    # 레포츠 캠핑장 소급 — 같은 규약.
    if (camping := drop_camping(out["proposals"])):
        print(f"[merge] 레포츠 캠핑장·숙영지 제거 — {camping}건", file=sys.stderr)
        out["stats"]["unique_proposals"] = len(out["proposals"])
        out["stats"]["camping_dropped"] = out["stats"].get("camping_dropped", 0) + camping
    # LLM 판정 소급 — 기준을 조이면(프롬프트 판본 상승) 적재된 행에도 소급된다.
    if (rejected := drop_rejected_verdicts(out["proposals"])):
        print(f"[merge] 판정 reject 제거 — {rejected}건", file=sys.stderr)
        out["stats"]["unique_proposals"] = len(out["proposals"])
        out["stats"]["rejected_dropped"] = out["stats"].get("rejected_dropped", 0) + rejected
    # 폐업 소급 제거 — 근거 파일이 없으면 빈 집합(= 판정 없음), 위와 같은 축소 가드 규약.
    if (closed := drop_closed(out["proposals"], load_closed_refs())):
        print(f"[merge] 폐업 제거 — {closed}건", file=sys.stderr)
        out["stats"]["unique_proposals"] = len(out["proposals"])
        out["stats"]["closed_dropped"] = out["stats"].get("closed_dropped", 0) + closed
    gone = start - {id(p) for p in out["proposals"]}
    existing = sum((ref_by_id or {}).get(i) in before_refs for i in gone)
    out["stats"]["retro_dropped_existing"] = out["stats"].get("retro_dropped_existing", 0) + existing


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("files", nargs="*", help="collected_pois.json 경로들")
    parser.add_argument("-o", "--output", help="합본 저장 경로 (생략 시 표준출력)")
    parser.add_argument("--self-check", action="store_true", help="병합 규칙 자체 검증만")
    parser.add_argument("--allow-mixed", action="store_true",
                        help="출처가 다른 문서도 합친다. 소비자가 **항목별 source 로 갈라** 보내야 한다 — 문서 레벨 source 는 하나뿐이다")
    parser.add_argument("--max-quarantined", type=int, default=MAX_QUARANTINED,
                        help=f"시도 미판정 격리 상한 — 넘으면 아무것도 쓰지 않고 실패 (기본 {MAX_QUARANTINED})")
    parser.add_argument("--state", help="수집 상태(collect_state.json). **주면 시도 게이트가 켜진다** — 공유본에 없던 미판정 "
                        "행을 격리하고 그 TourAPI 행을 기제안 색인에서 지운다. -o 가 입력 중 하나(덮어쓸 공유본)여야 하고, "
                        "상태가 없거나 형식이 틀리면 아무것도 쓰지 않고 실패한다. 안 주면 격리 없이 경고·stats 만 남긴다(구 워크플로 호환)")
    args = parser.parse_args(argv)

    if args.self_check:
        _self_check()
        return 0

    docs = []
    before: dict | None = None   # `-o` 가 입력 중 하나면 그게 덮어쓰기 전 공유본이다(축소 가드의 BEFORE)
    for f in args.files:
        try:
            docs.append(json.loads(Path(f).read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError) as e:
            print(f"[merge] 파일 건너뜀 (읽기 실패): {f} — {e}", file=sys.stderr)
            continue
        if args.output and Path(f).resolve() == Path(args.output).resolve():
            before = docs[-1]
    # 덮어쓸 공유본이 입력에 있는데 못 읽었으면 그것부터 말한다 — 아래 "-o 가 입력이어야 한다"는 틀린 진단이다.
    if args.state and args.output and before is None and any(
            Path(f).resolve() == Path(args.output).resolve() for f in args.files):
        print(f"[merge] FAIL 덮어쓸 공유본(-o {args.output})을 읽지 못했다 — 위 '파일 건너뜀' 참조 (아무것도 쓰지 않았다)",
              file=sys.stderr)
        return 1
    if not docs:
        print("[merge] 읽은 문서가 없습니다", file=sys.stderr)
        return 1

    # `--state` 는 **아무것도 쓰기 전에** 읽어 둔다 — 공유본을 쓴 뒤에 상태가 없다는 걸 알면 격리한 행이 색인에 남은
    # 채 공유본에서만 빠진다(반쪽 쓰기). 게이트를 켜 달라고 했는데 상태가 없으면 수집 파이프라인이 깨진 것이라 멈춘다.
    # 형식까지 수집기와 같은 규칙(`state.parse_state` — `proposed` 가 str→str 객체인가 …)으로 본다. JSON 이기만 하면
    # 통과시키면 `forget_quarantined` 가 공유본을 쓴 **뒤에** 터진다.
    if args.state:
        try:
            parse_state(Path(args.state).read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            print(f"[merge] FAIL --state 를 읽지 못했다: {args.state} — {e} (아무것도 쓰지 않았다)", file=sys.stderr)
            return 1
        # 게이트는 "공유본에 있던 키인가"로 격리와 남겨 둠을 가른다 — 덮어쓸 공유본(`-o`)이 입력에 없으면 그걸 알 수
        # 없어, 공유본에만 있던 행(다시 수집되지 않는 출처 포함)을 격리해 영영 잃는다.
        if before is None:
            print("[merge] FAIL --state 에는 -o 가 입력 문서 중 하나(덮어쓸 공유본)여야 한다 (아무것도 쓰지 않았다)",
                  file=sys.stderr)
            return 1

    out = merge(docs, allow_mixed=args.allow_mixed)
    history = versions_by_ref(docs)
    if (expanded := expand_sido_abbrev(out["proposals"])):
        print(f"[merge] 주소 시도 약칭 → 정식 이름 — {expanded}건", file=sys.stderr)
    ref_by_id = {id(v): r for r, vs in history.items() for v in vs}
    before_refs = frozenset(versions_by_ref([before])) if before else frozenset()
    retro_drops(out, ref_by_id, before_refs)
    # 시도 게이트는 소급 제거 **뒤** — 어차피 빠질 행(폐업·관광 무관 …)을 격리 건수·상한·경고에 세지 않는다.
    quarantined: list[dict] = []
    restored: list[dict] = []
    left: list[dict] = []
    if args.state:
        expand_sido_abbrev([v for vs in history.values() for v in vs[:-1]])   # 되돌릴 후보도 펴 둔다
        quarantined, restored, left = quarantine_unresolved_sido(
            out["proposals"], history=history, before_refs=before_refs, survives=_survives_retro_drops)
        # 되돌린 앞 판본은 소급 제거 뒤에 들어왔으므로 영업시간 재파싱도 여기서 받는다(나머지 행에는 멱등 — 이미 거쳤다).
        if restored and (recovered := reparse_open_hours(out["proposals"])):
            print(f"[merge] 영업시간 재파싱(되돌린 앞 판본) — {recovered}건 살림", file=sys.stderr)
        for q in quarantined[:5]:
            print(f"[merge] 시도 미판정 격리 — {q}", file=sys.stderr)
        for q in restored[:5]:
            print(f"[merge] 시도 미판정 — 앞 판본으로 되돌림 — {q}", file=sys.stderr)
        if len(quarantined) + len(restored) > args.max_quarantined:
            print(f"[merge] FAIL 시도 미판정 격리 {len(quarantined)}건 + 복원 {len(restored)}건 > 상한 "
                  f"{args.max_quarantined} — 카탈로그나 주소 형식이 바뀌었는지 확인할 것 (아무것도 쓰지 않았다)",
                  file=sys.stderr)
            return 1
        if quarantined or restored:
            out["stats"]["unique_proposals"] = len(out["proposals"])
            # 격리는 공유본에 없던 키뿐이라(공유본에 있던 키는 남겨 둔다 — 함수 docstring) 축소 가드에 더할 몫이 없다.
            out["stats"]["sido_quarantined"] = len(quarantined)
            out["stats"]["sido_quarantined_refs"] = quarantined
            out["stats"]["sido_restored_previous_refs"] = restored
    else:
        left = unresolved_sido(out["proposals"], history=history)
    if left:
        # 빼지 않고 남긴 미판정 행 — `--state` 없음(상태를 병합 **전에** 영속하는 main 의 구 사본·수동 병합: 빼면 기제안
        # 색인에 찍힌 채 공유본에도 없어 영구 유실) 또는 공유본에 이미 있던 행(위 함수 docstring). 크게 알리기만 한다.
        why = "공유본에 이미 있던 행" if args.state else "--state 없음"
        for q in left[:20]:
            print(f"::warning::[merge] 시도 미판정(격리 안 함 — {why}) {q}", file=sys.stderr)
        print(f"::warning::[merge] 백엔드가 시도를 못 정하는 행 {len(left)}건을 그대로 합쳤다 — "
              "backend-ci 실문서 IT(regionUnresolved == 0)가 깨질 수 있다", file=sys.stderr)
        out["stats"]["sido_unresolved"] = len(left)
        out["stats"]["sido_unresolved_refs"] = left
    if (trending := mark_trending(out["proposals"])):
        print(f"[merge] 요즘 인기 표지 — 기존 행 {trending}건", file=sys.stderr)
    text = dumps_doc(out)
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        print(text)
    if quarantined or restored:
        forgot = forget_quarantined(Path(args.state), quarantined + restored)
        print(f"[merge] 격리·복원분 기제안 색인에서 지움 — {forgot}건 "
              "(그 (지역, 타입)을 완주한 뒤 다시 훑을 때 다시 받는다)", file=sys.stderr)
    print(f"[merge] 실행 {len(docs)}개 → 제안 {sum(len(d['proposals']) for d in docs)}건(중복포함)"
          f" → 유니크 {out['stats']['unique_proposals']}건"
          + (f" → {args.output}" if args.output else ""), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
