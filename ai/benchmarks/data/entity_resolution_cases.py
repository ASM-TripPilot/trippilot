"""엔티티 해소 라벨 케이스셋 — 한국 POI 이름 변형 현실 모사 (TRIP-252, U3-03).

실데이터가 아직 없어 캘리브레이션 하네스용 수기 fixture로 시작한다.
각 케이스 = 사용자 입력(query) + closed-set 후보 풀(pool) + 정답 라벨(gold_poi_id).

라벨 의미:
- gold_poi_id 있음 → query는 그 POI의 표기 변형 (동일 장소).
  이상적 판정: AUTO. CONFIRM은 허용하되 불필요 확인(마찰) 비용.
- gold_poi_id None → query는 풀에 없는 다른 장소 (유사 이름 — 지점 다른
  프랜차이즈·동명 다른 카테고리 등). 이상적 판정: UNRESOLVED(웹 소싱 위임).
  CONFIRM은 방어로 허용(사용자 기각), AUTO는 오자동병합 = 최악.

순수 데이터 모듈 — trippilot·외부 패키지 import 0. Poi 변환은 하네스 몫.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ResolutionCase:
    case_id: str
    query: str
    pool: tuple[tuple[str, str], ...]  # (poi_id, name)
    gold_poi_id: str | None            # None = 풀에 정답 없음 (다른 장소)
    note: str


CASES: tuple[ResolutionCase, ...] = (
    # ── 동일 장소 표기 변형 (gold 있음) ──────────────────────────
    ResolutionCase(
        case_id="S01",
        query="성심땅",
        pool=(("s01-1", "성심당"), ("s01-2", "성심당 케익부띠끄"),
              ("s01-3", "빵장수단팥빵")),
        gold_poi_id="s01-1",
        note="자모 단위 오타 (AI-D04 대표 예시)",
    ),
    ResolutionCase(
        case_id="S02",
        query="성심당",
        pool=(("s02-1", "성심당 본점"), ("s02-2", "성심당 DCC점")),
        gold_poi_id="s02-1",
        note="지점 접미 생략 — 관례상 본점 지칭. 동률 시 poi_id 오름차순 결정론",
    ),
    ResolutionCase(
        case_id="S03",
        query="안목 해변",
        pool=(("s03-1", "안목해변"), ("s03-2", "안인해변"), ("s03-3", "강문해변")),
        gold_poi_id="s03-1",
        note="공백 변형 — 정규화로 흡수돼야 함",
    ),
    ResolutionCase(
        case_id="S04",
        query="경포해수욕장(경포해변)",
        pool=(("s04-1", "경포해수욕장"), ("s04-2", "경포호")),
        gold_poi_id="s04-1",
        note="괄호 병기 표기",
    ),
    ResolutionCase(
        case_id="S05",
        query="Terarosa 강릉본점",
        pool=(("s05-1", "테라로사 강릉본점"), ("s05-2", "테라로사 경포대점")),
        gold_poi_id="s05-1",
        note="영/한 혼용 — 자모 편집거리의 한계 사례",
    ),
    ResolutionCase(
        case_id="S06",
        query="강릉 오죽헌",
        pool=(("s06-1", "오죽헌"), ("s06-2", "선교장"),
              ("s06-3", "허균허난설헌기념공원")),
        gold_poi_id="s06-1",
        note="지역명 접두 — 짧은 원명에 접두가 붙으면 유사도 급락",
    ),
    ResolutionCase(
        case_id="S07",
        query="툇마루",
        pool=(("s07-1", "카페 툇마루"), ("s07-2", "안목커피거리")),
        gold_poi_id="s07-1",
        note="업종 접두 생략 표기",
    ),
    ResolutionCase(
        case_id="S08",
        query="테라로싸",
        pool=(("s08-1", "테라로사"), ("s08-2", "보사노바커피")),
        gold_poi_id="s08-1",
        note="된소리 오타 (자모 1개 차)",
    ),
    # ── 유사하지만 다른 장소 (gold None) ─────────────────────────
    ResolutionCase(
        case_id="D01",
        query="스타벅스 경포대점",
        pool=(("d01-1", "스타벅스 안목항점"), ("d01-2", "이디야커피 경포점")),
        gold_poi_id=None,
        note="지점 다른 프랜차이즈 — 브랜드 동일·장소 상이",
    ),
    ResolutionCase(
        case_id="D02",
        query="배스킨라빈스 강릉역점",
        pool=(("d02-1", "배스킨라빈스 강릉점"),),
        gold_poi_id=None,
        note="지점명 한 글자('역') 차 — 오자동병합 최고 위험 사례",
    ),
    ResolutionCase(
        case_id="D03",
        query="안인해변",
        pool=(("d03-1", "안목해변"), ("d03-2", "경포해변")),
        gold_poi_id=None,
        note="이름 유사한 다른 해변 (실존 지명)",
    ),
    ResolutionCase(
        case_id="D04",
        query="경포대",
        pool=(("d04-1", "경포대해수욕장"), ("d04-2", "경포호")),
        gold_poi_id=None,
        note="동명 다른 카테고리 — 누각(사적) vs 해수욕장",
    ),
    ResolutionCase(
        case_id="D05",
        query="강릉짬뽕옹심이",
        pool=(("d05-1", "강릉감자옹심이"),),
        gold_poi_id=None,
        note="유사 상호의 다른 식당",
    ),
    ResolutionCase(
        case_id="D06",
        query="투썸플레이스 강릉교동점",
        pool=(("d06-1", "투썸플레이스 강릉점"),),
        gold_poi_id=None,
        note="지점 다른 프랜차이즈 — 접미 음절 추가형",
    ),
)
