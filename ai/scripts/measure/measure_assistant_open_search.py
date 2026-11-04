r"""도우미 장소 탐색 열린 검색(KB-5 문서 순위, `place_search` + `hybrid_rank`) — 결정론 측정(LLM 0, 승인 불필요).

실행(ai/ 에서 — 로컬 서빙 임베딩 컨테이너만 부른다, 실 LLM·외부 API 0):
    TRIPPILOT_EMBEDDING_BASE_URL=http://localhost:8100 uv run python scripts/measure/measure_assistant_open_search.py
    EVAL_CASES=서울/비,제주/비 … 로 사례를 고른다(이름 앞부분 일치). 결과 JSON 은 `EVAL_OUT` 경로에도 쓴다.
  쌍대 판정(2단계 — **유료, 실 Claude 호출이라 사용자 승인 뒤에만**. 키는 환경 변수로만 받는다):
    ANTHROPIC_API_KEY=… TRIPPILOT_EMBEDDING_BASE_URL=http://localhost:8100 uv run python \
        scripts/measure/measure_assistant_open_search.py judge [반복=1]     # EVAL_JUDGE_MODEL(기본 claude-sonnet-5)·EVAL_WORKERS
    팔 짝 A-B(본 비교)·A-A(같은 입력 대조 — 이 흔들림보다 확실히 이겨야 켠다)·B-B3. 결과 JSON 에 짝마다 승패·같음·판정 실패
    (`judge_fail` — 0 이 아니면 승패로 읽지 말 것)·부호 검정 p. 두 목록이 같은 사례는 판정하지 않는다(`identical`, A-A 제외).

**무엇을 재나.** 운영 핸들러가 짓는 순서(규칙 정렬 `_explore_rank`)에 KB-5 문서 순위를 섞었을 때 **명백한 오답**이 줄어드는가.
판정 LLM 없이 코드가 셀 수 있는 것만 센다 — 비·실내를 물었는데 야외(자연·야경·액티비티 분류·'야외' 태그), 북카페를 물었는데 카페가
아닌 곳, 아이 동반을 물었는데 술집. 그 밖의 사례는 순서가 얼마나 바뀌는지(겹침 @3·@5)·문서 보유율만 본다.

**팔**: A 현행(규칙 정렬) · B 규칙+문서 RRF(키워드 근거 문턱, `hybrid_rank.fuse`) · B1 문서만(근거 있는 곳을 문서 순위로 앞에, 나머지 규칙
순서) · B3 임베딩만·문턱 없음(게이트도 없이 말 그대로 질의 — 2026-11-02 다시 짜기 '문서 몫' #1796 의 실패 재현 대조).
**변수**: 문서 무게 w ∈ {0.5, 1.0} · 게이트 G1(속성 낱말은 게이트를 안 연다)/G2(연다) · 질의 Q1(분류 theme)/Q2(지역을 뺀 발화).

**재료**는 운영과 같다 — POI 는 공유본(`measure_kb5_overview._pois`, 관광공사 contentid 를 source_ref 로), 풀은 운영 풀 조립
(`CandidatePoolBuilder(StaticPoiDb, M7Config)` — 지역 표 중심·반경), 정렬·자르기는 운영 함수(`dialogue_handlers._explore_rank`), 문서는
리포의 미리 계산 벡터(범위 조각만 `InMemoryVectorStore` 에 싣는다) + 질의만 로컬 KURE. B(w=1.0·G1·Q1)는 운영 핸들러
(`HANDLERS[...]` + `HandlerPorts.place_search`)로도 한 번 더 돌려 직접 계산과 같은지 대조한다(`e2e_mismatch` 0 이어야 한다).
그 대조는 SQL 미배정(= SQL 실패·0건) 분기다 — **운영 분기**(DIALOGUE_SQL 배정, SQL 이 행을 낸다)는 SQL 대역(`_SqlRows`)을 붙여 한 번 더
돌려, 열린 검색 순서가 답에 닿는지(`reach`)를 센다. 인메모리 스토어의 검색 시간은 pgvector 와 무관하다 — 시한·지연은 3단계(실 스택)에서 잰다.

**2026-11-04 규칙 변경(사용자 결정 "묘사형 말이면 열린 검색 우선", BR-AO-27 개정·BR-AO-36)** — 아래 '닿는 범위'는 변경 **전** 값이다.
이제 탐색도 SQL 과 나란히 열린 검색을 돌리고, 문서 순위가 실제로 섞이면(doc OK) 반경 결과가 SQL 행을 이긴다 — `prod_reach` 는 B 가 답을
바꾼 사례 전부가 된다. 변경 뒤 6사례 재측정(EVAL_CASES=서울/비,부산/비,제주/비실내,경주/비,대조/서울,서울/공예3): SQL 분기에서
닿는 비 탐색 0/4 → **4/4**(오답 A 9 → B 1 이 운영 분기 답이 된다), 대조/서울은 게이트가 닫혀 SQL 분기 그대로, `e2e_mismatch` 0.
쌍대 판정(`judge`)은 그 규칙을 켤지 정하는 측정이다.

**2026-11-04 결정론 측정 결론 — 반경 분기에서 B 가 명백한 오답을 줄였다. 그러나 운영 분기에서 그 사례들에 닿지 않는다(아래 '닿는 범위')
→ 2단계(유료 쌍대 판정) 전에 닿는 범위부터 정해야 한다.** 41사례(도시 10 × 날씨·분위기·동반·주제·개수형 30 + 대조군 7 + 11-02 겨눔 4),
오답 판정이 있는 17사례:
- 오답 합계 A 16 → **B(w=1.0·G1·Q1) 9**(줄어든 사례 4 · 늘어난 사례 1) · B(w=0.5) 13(4 → 3 · 늘어남 0) · B1 문서만 9(늘어남 0) ·
  B3 임베딩만 8(늘어남 1 — 겨눔/제주비). 줄어든 몫은 거의 **비·실내**다 — 게이트가 열린 비 사례 7개에서 A 10 → B 2(서울: 낙산공원·
  북악스카이 팔각정 → 서울시립미술관·세종문화회관 · 부산: 광안리해수욕장·황령산 → 부산문화회관·카페). 아이 동반(술집)은 규칙 정렬이 이미
  나이트라이프를 빼 모든 팔이 0 — 이 판정으로는 아무것도 못 가른다.
- **늘어난 1건(겨눔/북카페, 종류를 안 정한 "조용한 북카페")은 반쯤 판정 탓이다** — B 가 올린 북파크라운지는 개요가 "프리미엄 북카페"인데
  분류가 CULTURE 라 오답으로 셌다. 진짜 오답은 서대문 안산(자연 — 개요에 "북카페와 전망지가 있는" 숲길)이다. 종류를 CAFE 로 받은
  "서울 조용한 북카페"·"성수 조용한 북카페"는 두 팔 모두 0 이고 B 만 순서가 바뀐다.
- **11-02 겨눔의 날씨 둘("비 오는 날" — 서울·제주)은 게이트가 닫혀 B = A** 다(묘사 낱말이 '비' 한 글자뿐). 고치려면 날씨 말 확장(비 →
  실내, 계획 8(d))이 따로 필요하다. B3 는 같은 말에 레인리포트 경리단(이름이 '비')·채석장 전망대를 올렸다 — 11-02 실패가 재현된다.
- **B3 는 오답 수만 낮고 쓸 수 없다** — A 와의 겹침 @5 0.29(B 2.03), 대조군 일곱의 순서를 전부 바꾼다(B·B1 은 대조군 바이트까지 같다).
- **문서 보유율**(상위 목록 중 KB-5 조각이 있는 곳) A 0.53 → B 0.77 · B1 0.80 · B3 1.00 — 근거 문턱 때문에 문서가 있는 곳만 오를 수
  있어서다(설계상 편향). 유료 판정은 두 팔 모든 장소에 같은 참고 설명을 주고 "설명 없음은 부적합이 아님"을 명시해야 한다(계획 3단계).
- **닿는 범위(운영 분기)**: 운영은 DIALOGUE_SQL 이 배정돼 지역 앵커 탐색(EXPLORE)에서 NL2SQL 이 나란히 돌고, 행이 있으면 SQL 행이 답이다
  — 그래서 그때는 열린 검색을 돌리지도 않는다(`_plan_explore`, 버려질 순서에 임베딩·pgvector 를 쓰지 않게). 열린 검색이 답을 바꾼 28사례
  중 SQL 행이 있는 분기에서도 답에 닿는 것은 **추천 4사례뿐**(서울/공예3·부산/국밥2·경주/한옥카페2·대구/비3 — 추천은 반경이 먼저다)이고,
  오답이 준 4사례(서울·부산·제주·경주 비, 전부 EXPLORE)는 하나도 닿지 않는다. 반경 분기가 답이 되는 것은 SQL 실패·0건 턴·일정 근처·이어
  받은 지역뿐이다. 2단계 전에 고를 것: SQL 이 0건인 비율을 재거나(유료 — 실 NL2SQL), SQL 행에도 문서 순위를 섞을지(설계 변경).
- **게이트**: G1·Q1 열림 28/34, 대조군 0/7, 열린 사례 중 NO_EVIDENCE 0(2-gram BM25 > 0 은 쉽게 찬다 — 문턱은 '근거 없음'을 가르지
  못하고 순위의 바닥 역할만 한다). G2 는 4사례를 더 연다(속성 낱말만 — 아이랑·바다 보이는·조용한 작업) — 오답 차이 0, 순서만 더 흔든다
  → **G1**. Q2(지역을 뺀 발화)는 '쉬고·싶어·가지' 같은 빈말이 낱말에 남아 Q1 보다 나을 것이 없다 → **Q1**. 무게는 **w=1.0**(0.5 는 비 오답을
  10 → 7 만 줄인다).
- **범위 크기**: 규칙 정렬을 지난 장소 p50 571 · p95 3,805, 그중 조각이 있는 곳 p50 122 · p95 541, 조각 id p50 268 · p95 2,077
  (대조군 넷을 더하기 전 37사례는 370 · 246) → `place_search.MAX_IDS` 2,100(측정 사례는 안 잘린다).
- **출처 충돌**: 관광공사가 아닌 POI 의 원천 id 가 관광공사 contentid 와 같은 경우 0. 조각 표에 제 id 로 든 Overture 66·카카오 16 은
  위키 수집이 그 장소 id 로 적재한 같은 장소의 문서다(`_collisions` 註).
- 운영 핸들러 대조 `e2e_mismatch` 0(41/41) · 코퍼스 조각과 벡터 머리 불일치 0.
- 1회차(2-gram 끝 떼기 전)와 G1·Q1 오답 수는 같았다(Q2 는 10 → 9). 바뀐 것은 판정 밖 사례의 순서다 — '산책하기'의 '하기'가 생선찜집 개요에 걸렸고
  ('강릉/숲길'), Q2 의 '오는데'가 빈말로 게이트를 열었다(`hybrid_rank._VERB_ENDS` 註).
- 3회차(리뷰 반영 — 종류 이름 2-gram 을 BM25 항에서 빼고, 요청 꼴·복수 '들'·끝 붙은 종류 낱말로 게이트가 열리던 것을 닫았다): 오답 수는
  모든 팔이 같다(A 16 · B 9 · B0.5 13 · B1 9 · B3 8). 바뀐 것은 북카페 세 사례의 순서뿐이다 — 근거 장소가 서울/북카페 45 → 3 · 겨눔/북카페
  99 → 12 · 겨눔/성수북카페 36 → 3 으로 줄었다(그전 근거는 거의 '카페' 2-gram 하나였다). 겨눔/북카페의 늘어난 1건은 그대로다 — 서대문 안산은
  개요에 '북카페'가 실제로 들어 '북카' 근거가 남고, 다른 근거가 빠지자 1위로 올랐다. 새 대조군 넷(핫플레이스·인기 많은·먹을 만한·관광지들)은 닫혀 B = A(바이트까지).
"""

from __future__ import annotations

import json
import math
import os
import random
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

_AI = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_AI / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("TRIPPILOT_EMBEDDING_BASE_URL", "http://localhost:8100")
if urlparse(os.environ["TRIPPILOT_EMBEDDING_BASE_URL"]).hostname not in ("localhost", "127.0.0.1"):
    raise SystemExit("결정론 측정은 로컬 임베딩 컨테이너만 쓴다 — TRIPPILOT_EMBEDDING_BASE_URL 을 localhost 로")

from measure_kb5_overview import _Knowledge, _pois  # noqa: E402
from measure_prompt_ab import _INDOOR_AVOID  # noqa: E402
from trippilot.agents.adapters.memory_vector_store import InMemoryVectorStore  # noqa: E402
from trippilot.agents.planb import place_search as ps  # noqa: E402
from trippilot.agents.planb.kb_retrieval import collection_for, retrieve  # noqa: E402
from trippilot.api.wiring import StaticPoiDb  # noqa: E402
from trippilot.domain.common import BudgetLevel, TraceId, TransportMode  # noqa: E402
from trippilot.domain.dialogue.intent import Intent  # noqa: E402
from trippilot.domain.kb import KbKind  # noqa: E402
from trippilot.domain.poi.poi import NIGHTLIFE_TAG, PoiCategory  # noqa: E402
from trippilot.domain.poi.poi_curation import CandidatePoolRequest  # noqa: E402
from trippilot.llm_gateway.adapters.caching_embedding import CachingEmbedding  # noqa: E402
from trippilot.orchestrator.dialogue import dialogue_handlers as dh  # noqa: E402
from trippilot.orchestrator.dialogue.dialogue_handlers import (  # noqa: E402
    HANDLERS, HandlerPorts, TaskResult, TurnContext, TurnSnapshot,
)
from trippilot.poi_curation import hybrid_rank as hr  # noqa: E402
from trippilot.poi_curation.adapters.pg_place_sql import PlaceRow  # noqa: E402
from trippilot.poi_curation.chunking import chunk_corpus  # noqa: E402
from trippilot.poi_curation.config import M7Config  # noqa: E402
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder  # noqa: E402

_KST = timezone(timedelta(hours=9))
_NOW = datetime(2026, 11, 4, 11, 0, tzinfo=_KST)
_SNAP = TurnSnapshot(surface="HOME", trip=None, base_stays=(), itinerary_status=None, days=())
_EX, _RC = Intent.EXPLORE_PLACES, Intent.RECOMMEND_PLACES
_CORPUS_FILES = ("place_corpus_overview.jsonl.gz", "place_corpus_wiki.jsonl.gz")

# (이름, 의도, 분류 인자, 발화, 오답 판정) — 인자는 분류가 낼 법한 꼴로 고정한다(분류가 묘사 낱말을 theme 에 남기는지는 2단계 유료 측정).
# 오답 판정: rain(비·실내 → 야외) · book(북카페 → 카페 아닌 곳) · kids(아이 동반 → 술집) · None(오답 기준 없음 — 순서 변화만 본다)
CASES: tuple[tuple, ...] = (
    ("서울/비", _EX, {"region": "서울", "theme": "비 오는 날 실내"}, "서울 비 오는 날 실내 갈 만한 곳 알려줘", "rain"),
    ("서울/북카페", _EX, {"region": "서울", "category": "CAFE", "theme": "조용한 북카페"}, "서울 조용한 북카페 추천해줘", "book"),
    ("서울/아이", _EX, {"region": "서울", "theme": "아이랑 가기 좋은"}, "서울에서 아이랑 가기 좋은 곳", "kids"),
    ("서울/역사", _EX, {"region": "서울", "theme": "역사 체험"}, "서울 역사 체험할 곳", None),
    ("서울/공예3", _RC, {"region": "서울", "category": "CULTURE", "theme": "전통 공예 체험", "count": "3"},
     "서울 전통 공예 체험할 곳 세 군데 골라줘", None),
    ("부산/비", _EX, {"region": "부산", "theme": "비 오는 날 실내"}, "부산에 비 오는 날 실내로 갈 데", "rain"),
    ("부산/바다카페", _EX, {"region": "부산", "category": "CAFE", "theme": "바다 보이는 조용한"}, "부산 바다 보이는 조용한 카페", None),
    ("부산/시장", _EX, {"region": "부산", "theme": "전통 시장 구경"}, "부산 전통 시장 구경할 곳", None),
    ("부산/국밥2", _RC, {"region": "부산", "category": "FOOD", "theme": "돼지국밥", "count": "2"}, "부산 돼지국밥 두 곳만 골라줘", None),
    ("제주/비실내", _EX, {"region": "제주", "theme": "비 오는 날 실내 체험"}, "제주 비 오는 날 실내 체험할 곳", "rain"),
    ("제주/아이", _EX, {"region": "제주", "theme": "아이랑 체험"}, "제주에서 아이랑 체험할 곳", "kids"),
    ("제주/오름", _EX, {"region": "제주", "category": "NATURE", "theme": "오름 산책"}, "제주 오름 산책 추천", None),
    ("경주/신라", _EX, {"region": "경주", "theme": "신라 역사 유적"}, "경주 신라 역사 유적 보고 싶어", None),
    ("경주/비", _EX, {"region": "경주", "theme": "비 오는 날 실내"}, "경주 비 오는 날 실내 갈 만한 곳", "rain"),
    ("경주/한옥카페2", _RC, {"region": "경주", "category": "CAFE", "theme": "한옥 카페", "count": "2"}, "경주 한옥 카페 두 곳 골라줘", None),
    ("전주/한옥", _EX, {"region": "전주", "theme": "한옥 전통 체험"}, "전주 한옥 전통 체험", None),
    ("전주/비빔밥", _EX, {"region": "전주", "category": "FOOD", "theme": "비빔밥"}, "전주 비빔밥 맛집", None),
    ("전주/아이", _EX, {"region": "전주", "theme": "아이와 가볼 만한"}, "전주 아이와 가볼 만한 곳", "kids"),
    ("강릉/바다카페", _EX, {"region": "강릉", "category": "CAFE", "theme": "바다 전망"}, "강릉 바다 전망 카페", None),
    ("강릉/비", _EX, {"region": "강릉", "theme": "비 오는 날 실내"}, "강릉 비 오는 날 실내 놀거리", "rain"),
    ("강릉/숲길", _EX, {"region": "강릉", "theme": "산책하기 좋은 숲길"}, "강릉 산책하기 좋은 숲길", None),
    ("여수/해산물", _EX, {"region": "여수", "category": "FOOD", "theme": "해산물"}, "여수 해산물 맛집", None),
    ("여수/비", _EX, {"region": "여수", "theme": "비 오는 날 실내"}, "여수 비 오는 날 실내 갈 곳", "rain"),
    ("속초/생선구이", _EX, {"region": "속초", "category": "FOOD", "theme": "생선구이"}, "속초 생선구이 잘하는 곳", None),
    ("속초/아이", _EX, {"region": "속초", "theme": "아이랑 체험"}, "속초 아이랑 체험할 곳", "kids"),
    ("대구/근대", _EX, {"region": "대구", "theme": "근대 골목 역사"}, "대구 근대 골목 역사 여행", None),
    ("대구/작업카페", _EX, {"region": "대구", "category": "CAFE", "theme": "조용한 작업하기 좋은"}, "대구 조용히 작업하기 좋은 카페", None),
    ("대구/비3", _RC, {"region": "대구", "theme": "비 오는 날 실내", "count": "3"}, "대구 비 오는 날 실내 세 곳 추천", "rain"),
    ("인천/아이", _EX, {"region": "인천", "theme": "아이랑 가기 좋은 박물관"}, "인천 아이랑 가기 좋은 박물관", "kids"),
    ("인천/차이나", _EX, {"region": "인천", "theme": "차이나타운 근대 거리"}, "인천 차이나타운 근대 거리 구경", None),
    # 대조군 — 게이트가 닫혀야 한다(B = A, 바이트까지). 뒤 넷은 리뷰(2026-11-04)가 찾은 꼴 — 낱말 안 조각만 지워 남은 꼬리
    # ('레이스'·'많은'·'먹을')와 복수 '들'이 게이트를 열었다
    ("대조/서울", _EX, {"region": "서울", "theme": "가볼 만한"}, "서울 가볼 만한 곳", None),
    ("대조/부산", _EX, {"region": "부산", "category": "FOOD", "theme": "맛집"}, "부산 맛집", None),
    ("대조/제주", _EX, {"region": "제주", "category": "CAFE", "theme": "카페 추천"}, "제주 카페 추천", None),
    ("대조/핫플", _EX, {"region": "서울", "theme": "핫플레이스"}, "서울 핫플레이스 알려줘", None),
    ("대조/인기", _EX, {"region": "서울", "theme": "인기 많은"}, "서울 인기 많은 곳", None),
    ("대조/먹을", _EX, {"region": "부산", "category": "FOOD", "theme": "먹을 만한"}, "부산 먹을 만한 곳", None),
    ("대조/관광지", _EX, {"region": "제주", "theme": "관광지들"}, "제주 관광지들 알려줘", None),
    # 11-02 실패 겨눔(#1796 — 비 오는 날에 숭례문·용두암, 북카페에 라멘집)
    ("겨눔/서울비", _EX, {"region": "서울", "theme": "비 오는 날"}, "비 오는 날 서울에서 갈 만한 곳", "rain"),
    ("겨눔/제주비", _EX, {"region": "제주", "theme": "비 오는 날"}, "제주에 비 오는데 어디 가지", "rain"),
    ("겨눔/북카페", _EX, {"region": "서울", "theme": "조용한 북카페"}, "서울 조용한 북카페에서 쉬고 싶어", "book"),
    ("겨눔/성수북카페", _EX, {"region": "성수", "category": "CAFE", "theme": "조용한 북카페"}, "성수 조용한 북카페", "book"),
)
VARIANTS = tuple((g, q) for g in hr.GATES for q in ("Q1", "Q2"))
WEIGHTS = (0.5, 1.0)
UNCAPPED = 10 ** 9


def _wrong(kind: str | None, p) -> bool:
    if kind == "rain":  # 이름이 실내라고 말하는 곳(실내수영장·실내암벽 — 분류는 액티비티)은 빼고 센다 — A 의 이름 적중이 오답으로 부풀지 않게
        return (p.category in _INDOOR_AVOID or "야외" in p.tags) and "실내" not in p.name
    if kind == "book":
        return p.category is not PoiCategory.CAFE
    if kind == "kids":
        return NIGHTLIFE_TAG in p.tags or p.category is PoiCategory.BAR
    return False


def _doc_first(rule: list, ranks: dict[str, int]) -> list:
    """근거 있는 곳을 그 순위로 앞에, 나머지는 규칙 순서 — B1·B3."""
    doc = sorted((p for p in rule if p.source_ref in ranks), key=lambda p: ranks[p.source_ref])
    return doc + [p for p in rule if p.source_ref not in ranks]


def _collisions(index) -> tuple[Counter, Counter]:
    """(우연한 겹침, 제 문서) — 관광공사가 아닌 출처 POI 의 원천 id 가 관광공사 contentid 와 같은 수(우연한 겹침 — 0 이 아니면 남의 문서가
    붙는다, 중단), 그리고 조각 표에 제 id 로 든 수(위키 수집이 Overture·카카오 장소를 그 id 로 적재했다 — 같은 장소의 문서라 정상).
    2026-11-04 확인: 제 문서 82건(Overture 66·카카오 16) 중 77건은 제목이 이름과 같고 나머지 5건도 같은 곳의 다른 이름(양재시민의숲 ↔
    매헌시민의숲 등)이다. 관광공사 id 는 최대 4,140,736 이고 카카오 id 는 숫자라 그 아래로 내려오면 겹칠 수 있다 — 이 수가 그 경보다."""
    doc = json.loads((_AI / "data/collected_pois.json").read_text(encoding="utf-8"))
    tour = {str(pr["provenance"]["content_id"]) for pr in doc["proposals"] if pr.get("source") == "TOURAPI"}
    accidental, own = Counter(), Counter()
    for pr in doc["proposals"]:
        ref = str((pr.get("provenance") or {}).get("content_id") or "")
        if pr.get("source") == "TOURAPI" or not ref:
            continue
        if ref in tour:
            accidental[pr.get("source")] += 1
        elif ref in index:
            own[pr.get("source")] += 1
    return accidental, own


class _SqlRows:
    """운영 분기 대역 — 운영 시크릿에는 DIALOGUE_SQL 이 배정돼 있어(`.env.example`) 지역 앵커 탐색은 NL2SQL 이 반경 탐색과 나란히 돌고, SQL 이
    행을 내면 탐색(EXPLORE)은 그 행을 쓴다(`_assemble_explore` — 11-04 부터 문서 순위가 섞인 탐색은 예외).
    실 LLM 없이 "행이 있었다"만 흉내 낸다 — 그 지역 시·도의 한 행."""

    writes_sql = True

    def __init__(self, sido: str | None) -> None:
        self._row = PlaceRow(poi_id="sql-row", name="SQL 행", category="명소", sido=sido or "", sigungu=None, trending=False,
                             nightlife=False)

    def lookup(self, utterance, arguments, trace_id, now, *, timeout_sec):
        return [self._row]


class _Corpus:
    """`_Knowledge` 의 코퍼스 행·미리 계산 벡터로 범위 조각만 스토어에 싣는다."""

    def __init__(self, kn: _Knowledge) -> None:
        self.kn = kn
        self.missing = 0

    def store(self, refs: list[str], ids: frozenset[str], model_id: str) -> InMemoryVectorStore:
        store, coll = InMemoryVectorStore(), collection_for(KbKind.POI_DESC, model_id)
        for name in _CORPUS_FILES:
            rows, vectors = self.kn.rows[name], self.kn.vectors[name]
            for d in chunk_corpus(rows[r] for r in refs if r in rows):
                if d.doc_id not in ids:
                    continue
                try:
                    store.upsert(coll, d.doc_id, vectors.vector(d.doc_id), d.payload())
                except KeyError:
                    self.missing += 1  # 코퍼스 조각과 벡터 머리가 어긋났다 — 적재 정합 문제(요약에 센다)
        return store


def _top(rank: list, intent: Intent, count: str | None) -> list:
    n = int(count) if intent is _RC and count in ("1", "2", "3", "4", "5") else dh.MAX_CANDIDATES
    return rank[:n]


def measure(case, builder, emb, corpus, index, keep: dict | None = None) -> dict:
    """`keep` 을 주면 팔별 상위 목록(Poi)을 거기 담는다 — 쌍대 판정(`judge`)이 같은 목록을 판정에 넘긴다."""
    name, intent, args, utt, kind = case
    category, theme = args.get("category"), args.get("theme")
    ctx = TurnContext(snapshot=_SNAP, arguments=args, now=_NOW, tz=_KST, trace_id=TraceId(f"m-{name}"),
                      remaining_ms=lambda: 7000, ports=HandlerPorts(pool_builder=builder), utterance=utt, heard=utt)
    anchor = dh._explore_anchor(ctx)
    pool = builder.build(CandidatePoolRequest(anchor=anchor.center, dates=(_NOW.date(),), budget=BudgetLevel.HIGH,
                                              transport=TransportMode.PUBLIC, radius_override_km=anchor.radius_km), _NOW)
    captured: list[list] = []
    a_rank = dh._explore_rank(pool.pois, category, theme, utt, fuse=lambda r: captured.append(list(r)) or r)
    rule = captured[0]

    def ranked(order: list) -> list:
        return _top(dh._explore_rank(pool.pois, category, theme, utt, fuse=lambda r: order), intent, args.get("count"))

    refs = [p.source_ref for p in rule if p.source_ref]
    all_refs, all_ids = ps.scope_ids(refs, index, UNCAPPED)
    scope_refs, ids = ps.scope_ids(refs, index, ps.MAX_IDS)
    order = {r: i for i, r in enumerate(scope_refs)}
    store = corpus.store(scope_refs, ids, emb.model_id)
    hits_of: dict[str, tuple] = {}

    def hits(text: str) -> tuple:
        if text not in hits_of:
            hits_of[text] = retrieve(KbKind.POI_DESC, text, emb, store, top_k=len(ids), item_ids=ids) if ids else ()
        return hits_of[text]

    night = dh._said_night(category, theme, utt)
    # 운영 `_open_query` 와 같은 조건(이어 묻기 사례는 없다) — SQL 미배정·SQL 실패/0건 분기다. SQL 이 행을 내는 분기는 아래 `prod`
    runs = anchor.kind in ("region", "itinerary") and not night
    kind_ko = dh._CATEGORY_KO.get(category or "")
    arms: dict[str, list] = {"A": _top(a_rank, intent, args.get("count"))}
    variants: dict[str, dict] = {}
    for gate, q in VARIANTS:
        text = theme if q == "Q1" else utt
        query = hr.open_query(text, kind_ko, generic=dh._GENERIC_WORDS, gate=gate) if runs else None
        tag = f"{gate}{q}"
        if query is None or not ids:
            status, ranks = ("CLOSED" if query is None else "EMPTY"), {}
        else:
            ranks = hr.doc_rank(hits(query.text), query.words, order)
            status = "OK" if ranks else "NO_EVIDENCE"
        variants[tag] = {"status": status, "evidence": len(ranks), "words": list(query.words) if query else []}
        for w in WEIGHTS:
            arms[f"B{w}/{tag}"] = ranked(hr.fuse(rule, ranks, w))
        arms[f"B1/{tag}"] = ranked(_doc_first(rule, ranks))
    # B3 — 게이트·문턱 없이 말 그대로(질의 = theme 또는 발화 + 종류) 임베딩 순위만
    for q in ("Q1", "Q2"):
        raw = " ".join(x for x in ((theme if q == "Q1" else utt) or "", kind_ko or "") if x).strip()
        emb_ranks = hr.ranks(hr.embedding_scores(hits(raw)), order) if raw and ids else {}
        arms[f"B3/{q}"] = ranked(_doc_first(rule, emb_ranks))

    # 운영 경로 대조 — A(검색기 없음)·B(w=W_DOC, G1, Q1)를 핸들러 그대로 돌려 직접 계산과 같은지
    def e2e(searcher, sql=None) -> tuple[list[str], str | None]:
        ports = HandlerPorts(pool_builder=builder, place_search=searcher, place_sql=sql)
        # 인메모리 전수 스캔(파이썬 코사인)은 수천 조각에 수 초라 운영 시한(2.8s)을 넘긴다 — 대조에서만 시한을 풀어 순서만 본다
        c = TurnContext(snapshot=_SNAP, arguments=args, now=_NOW, tz=_KST, trace_id=TraceId(f"e2e-{name}"),
                        remaining_ms=lambda: 600_000, ports=ports, utterance=utt, heard=utt)
        handler = HANDLERS[intent]
        results = {t.name: TaskResult.ok(t.name, t.fn()) for t in handler.plan(c)}
        facts = handler.assemble(c, results)
        return [p.name for p in facts.places], results["explore"].value.get("doc")

    t0 = time.monotonic()
    e2e_b, e2e_status = e2e(ps.PlaceSearch(emb, store, index=lambda: index))
    e2e_ms = int((time.monotonic() - t0) * 1000)
    e2e_a, _ = e2e(None)
    expect_b = [p.name for p in arms[f"B{hr.W_DOC}/G1Q1"]]
    mismatch = (e2e_a != [p.name for p in arms["A"]]) + (e2e_b != expect_b)
    # 운영 분기(SQL 배정, 행 있음) — 열린 검색 순서가 답에 닿는가. 탐색은 문서 순위가 섞였을 때(doc OK)만 반경이 SQL 행을 이기고
    # (2026-11-04 규칙 변경, BR-AO-27 개정), 추천은 반경이 먼저다
    sido = dh.region_area(anchor.label)[0] if anchor.kind == "region" else None
    prod_names, prod_status = e2e(ps.PlaceSearch(emb, store, index=lambda: index), _SqlRows(sido))

    if keep is not None:
        keep.update(arms)

    def stats(rank: list) -> dict:
        return {"names": [p.name for p in rank], "cats": [p.category.value for p in rank],
                "wrong": sum(_wrong(kind, p) for p in rank),
                "docs": sum(1 for p in rank if p.source_ref in index), "n": len(rank)}

    return {"name": name, "kind": kind, "group": name.split("/")[0], "anchor": anchor.label, "pool": len(pool.pois),
            "fits": len(rule), "scope_places": len(all_refs), "scope_ids": len(all_ids), "capped_places": len(scope_refs),
            "capped_ids": len(ids), "variants": variants, "arms": {k: stats(v) for k, v in arms.items()},
            "e2e_status": e2e_status, "e2e_ms": e2e_ms, "e2e_mismatch": mismatch,
            "changed": e2e_b != e2e_a, "prod_status": prod_status, "prod_reach": e2e_b != e2e_a and prod_names == expect_b}


def _pct(values: list[int], p: float) -> int:
    s = sorted(values)
    return s[min(len(s) - 1, int(round(p * (len(s) - 1))))] if s else 0


def _overlap(a: dict, b: dict, k: int) -> int:
    return len(set(a["names"][:k]) & set(b["names"][:k]))


def summarize(rows: list[dict], collisions: Counter, missing: int) -> dict:
    normal = [r for r in rows if r["group"] != "대조"]
    controls = [r for r in rows if r["group"] == "대조"]
    judged = [r for r in rows if r["kind"]]
    arms = list(rows[0]["arms"])
    out: dict = {"cases": len(rows), "judged": len(judged), "collisions_non_tourapi": dict(collisions),
                 "corpus_vector_missing": missing, "e2e_mismatch": sum(r["e2e_mismatch"] for r in rows),
                 "e2e_status": dict(Counter(r["e2e_status"] for r in rows))}
    a_wrong = {r["name"]: r["arms"]["A"]["wrong"] for r in judged}
    out["wrong"] = {}
    for arm in arms:
        worse = [r["name"] for r in judged if r["arms"][arm]["wrong"] > a_wrong[r["name"]]]
        better = [r["name"] for r in judged if r["arms"][arm]["wrong"] < a_wrong[r["name"]]]
        out["wrong"][arm] = {"total": sum(r["arms"][arm]["wrong"] for r in judged), "better": len(better), "worse": worse}
    out["doc_share"] = {arm: round(sum(r["arms"][arm]["docs"] for r in rows) / max(1, sum(r["arms"][arm]["n"] for r in rows)), 3)
                        for arm in arms}
    out["overlap_vs_A"] = {arm: {"@3": round(sum(_overlap(r["arms"]["A"], r["arms"][arm], 3) for r in normal) / len(normal), 2),
                                 "@5": round(sum(_overlap(r["arms"]["A"], r["arms"][arm], 5) for r in normal) / len(normal), 2)}
                           for arm in arms if arm != "A"}
    out["gate_open"] = {}
    for gate, q in VARIANTS:
        tag = f"{gate}{q}"
        opened = [r for r in normal if r["variants"][tag]["status"] != "CLOSED"]
        out["gate_open"][tag] = {
            "cases": f"{len(opened)}/{len(normal)}",
            "controls": f"{sum(r['variants'][tag]['status'] != 'CLOSED' for r in controls)}/{len(controls)}",
            "no_evidence": f"{sum(r['variants'][tag]['status'] == 'NO_EVIDENCE' for r in opened)}/{len(opened)}",
            "empty": sum(r["variants"][tag]["status"] == "EMPTY" for r in opened),
        }
    out["controls_identical"] = {arm: all(r["arms"][arm]["names"] == r["arms"]["A"]["names"] for r in controls)
                                 for arm in arms if not arm.startswith("B3")}
    for key in ("fits", "scope_places", "scope_ids"):
        vals = [r[key] for r in rows]
        out[key] = {"p50": _pct(vals, 0.5), "p95": _pct(vals, 0.95), "max": max(vals)}
    out["capped_cases"] = [r["name"] for r in rows if r["capped_ids"] < r["scope_ids"]]
    # 열린 검색이 답을 바꾼 사례(SQL 미배정·실패 분기) 중 운영 분기(SQL 행 있음)에서도 그 순서가 답에 닿는 사례 — 측정 결론이 닿는 범위
    out["reach"] = {"changed": [r["name"] for r in rows if r["changed"]],
                    "changed_judged": [r["name"] for r in judged if r["changed"]],
                    "with_sql": [r["name"] for r in rows if r["prod_reach"]],
                    "with_sql_status": dict(Counter(str(r["prod_status"]) for r in rows))}
    out["max_ids"] = ps.MAX_IDS
    return out


def main() -> None:
    dh._FANOUT_SQL_CAP_S = 120.0  # 위 `e2e` 註(문서 단계 시한은 `_fanout_left` 몫) — 측정 프로세스 안에서만
    t0 = time.monotonic()
    kn = _Knowledge()
    emb = CachingEmbedding(kn.emb)
    pois = _pois()
    builder = CandidatePoolBuilder(StaticPoiDb(tuple(pois)), M7Config())
    index = hr.chunk_index()
    collisions, own = _collisions(index)
    print(f"loaded pois={len(pois)} index_places={len(index)} chunks={sum(map(len, index.values()))} "
          f"accidental={dict(collisions)} own_docs={dict(own)} ({time.monotonic() - t0:.1f}s)", flush=True)
    if sum(collisions.values()):
        print("관광공사가 아닌 출처의 source_ref 가 관광공사 contentid 와 겹친다 — 출처 접두 조인이 먼저 필요하다(중단)")
        raise SystemExit(2)
    picks = tuple(filter(None, os.environ.get("EVAL_CASES", "").split(",")))
    corpus = _Corpus(kn)
    rows = []
    for case in CASES:
        if picks and not case[0].startswith(picks):
            continue
        t = time.monotonic()
        r = measure(case, builder, emb, corpus, index)
        rows.append(r)
        a, b = r["arms"]["A"], r["arms"][f"B{hr.W_DOC}/G1Q1"]
        v = r["variants"]
        print(f"{r['name']:<14} fits {r['fits']:>5} scope {r['scope_places']:>4}곳/{r['scope_ids']:>5}조각 "
              f"G1Q1 {v['G1Q1']['status']:<11} G2Q1 {v['G2Q1']['status']:<11} G1Q2 {v['G1Q2']['status']:<11} "
              f"오답 A{a['wrong']} B{b['wrong']} B1 {r['arms']['B1/G1Q1']['wrong']} B3 {r['arms']['B3/Q1']['wrong']} "
              f"e2e {r['e2e_status']}·{r['e2e_ms']}ms{' MISMATCH' if r['e2e_mismatch'] else ''} "
              f"SQL분기 {r['prod_status']}{' 닿음' if r['prod_reach'] else ''} ({time.monotonic() - t:.1f}s)",
              flush=True)
        for label, arm in (("A ", a), ("B ", b), ("B3", r["arms"]["B3/Q1"])):
            print(f"    {label}: " + " / ".join(f"{n}({c})" for n, c in zip(arm["names"], arm["cats"])))
        print(f"    낱말 G1Q1 {v['G1Q1']['words']} · G1Q2 {v['G1Q2']['words']}", flush=True)
    summary = summarize(rows, collisions, corpus.missing)
    summary["own_docs_non_tourapi"] = dict(own)
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    out = os.environ.get("EVAL_OUT")
    if out:
        Path(out).write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")


# ── 쌍대 판정(유료 — 실 Claude 호출, 사용자 승인 뒤에만 돌린다) ──────────────────────────────────────────────────────────────
# 팔 짝: A-B(현행 대 섞인 순서 — 본 비교) · A-A(같은 입력 대조 — 판정의 흔들림·자리 편향, 이것보다 확실히 이겨야 켠다) ·
# B-B3(섞인 순서 대 임베딩만 — 근거 문턱의 값). 두 목록이 같은 사례는 판정하지 않고 `identical` 로 센다(A-A 만 예외 — 그것이 대조다).
JUDGE = os.environ.get("EVAL_JUDGE_MODEL", "claude-sonnet-5")
JUDGE_ARMS = {"A": "A", "B": f"B{hr.W_DOC}/G1Q1", "B3": "B3/Q1"}  # 판정 이름 → `measure` 의 팔(B 는 운영 설정 w=1.0·G1·Q1)
JUDGE_PAIRS = (("A", "B"), ("A", "A"), ("B", "B3"))
_NO_DOC = "설명 없음"


def _reference(kn: _Knowledge, p) -> str:
    """판정자용 참고 설명 — 두 목록에 똑같이: 관광공사 개요 → 위키 도입부 → '설명 없음'(대체 문서는 쓰지 않는다 — 열린 검색도 안 쓴다)."""
    for name in ("place_corpus_overview.jsonl.gz", "place_corpus_wiki.jsonl.gz"):
        row = kn.rows[name].get(p.source_ref or "")
        if row and row.get("sections"):
            return " ".join(row["sections"][0]["text"].split())[:400]
    return _NO_DOC


def _card(p) -> str:
    kind = dh._CATEGORY_KO.get(p.category.value, p.category.value)
    return f"분류: {kind} · 태그: {', '.join(p.tags) or '없음'}"


def judge_prompt(utterance: str, a: list, b: list, kn: _Knowledge) -> str:
    places = {str(p.poi_id): p for p in (*a, *b)}  # 두 목록의 모든 장소 — 같은 자료를 한 번씩

    def show(items: list) -> str:
        return "\n".join(f"{i}. {p.name} ({dh._CATEGORY_KO.get(p.category.value, p.category.value)})"
                         for i, p in enumerate(items, 1)) or "(목록 없음)"

    refs = "\n".join(f"- {p.name} — {_card(p)} · 설명: {_reference(kn, p)}" for p in places.values())
    return (
        f"여행자가 여행 도우미에게 이렇게 물었다: \"{utterance}\"\n"
        "도우미가 보여 줄 장소 목록이 두 개 있다. 목록은 위에서부터 보이고, 앞 순서일수록 먼저 눈에 든다.\n\n"
        f"[목록 A]\n{show(a)}\n\n[목록 B]\n{show(b)}\n\n"
        f"[참고: 장소 사실 카드와 설명 — 두 목록 모두에 같은 자료]\n{refs}\n\n"
        "어느 목록이 이 요청에 더 잘 맞는지 고르세요. 기준: ① 요청의 묘사·조건에 실제로 맞는 곳이 앞에 있는가 "
        "② 요청과 어긋나는 곳(예: 비 오는 날에 야외)이 앞에 있지 않은가.\n"
        f"'{_NO_DOC}'은 자료가 없다는 뜻일 뿐 그곳이 부적합하다는 뜻이 아닙니다 — 분류·태그·이름으로 판단하고, 설명이 있다는 이유만으로 "
        "높이 치지 마세요. 목록 길이·문체는 보지 마세요. 두 목록이 같거나 우열이 없으면 \"같음\".\n"
        '답은 JSON 한 줄: {"winner": "A" 또는 "B" 또는 "같음", "why": "한 문장"}'
    )


def read_verdict(text: str, stop_reason: str | None) -> tuple[str | None, str]:
    """(승자 'A'·'B'·'=' 또는 None = 판정 실패, 까닭). **못 읽은 판정을 '같음'으로 삼키지 않는다** — 11-04 사고(KB-5 A/B: 사고가
    `max_tokens` 를 다 먹어 본문이 비었고 32판 전부 '같음'으로 세어졌다, `docs/conventions/anti-patterns.md`)."""
    if stop_reason != "end_turn":
        return None, f"판정 실패: stop_reason={stop_reason}"
    try:
        got = json.loads(text[text.index("{"): text.rindex("}") + 1])
    except ValueError:
        return None, f"판정 실패: 파싱 {text[:80]!r}"
    winner = {"A": "A", "B": "B", "같음": "="}.get(str(got.get("winner", "")).strip()) if isinstance(got, dict) else None
    if winner is None:
        return None, f"판정 실패: winner {text[:80]!r}"
    return winner, str(got.get("why", ""))


def sign_test_p(wins: int, losses: int) -> float:
    """양측 부호 검정(같음·판정 실패 제외) — 이항(n, 1/2) 에서 min(승, 패) 이하가 나올 확률의 두 배."""
    n = wins + losses
    if n == 0:
        return 1.0
    tail = sum(math.comb(n, k) for k in range(min(wins, losses) + 1)) / 2 ** n
    return min(1.0, 2 * tail)


def _ask_judge(client, prompt: str) -> tuple[str | None, str]:
    import anthropic

    try:
        # effort low + 2000 — 400 으로 두면 사고가 상한을 먹어 본문이 빈다(11-02 KB-5 A/B 1차). Claude 5 세대는 temperature 를 400 으로 거부한다
        out = client.messages.create(model=JUDGE, max_tokens=2000, output_config={"effort": "low"},
                                     messages=[{"role": "user", "content": prompt}])
    except anthropic.APIError as e:  # 호출 실패도 판정 실패로 센다 — 같음으로 접지 않는다
        return None, f"판정 실패: {type(e).__name__}"
    text = "".join(b.text for b in out.content if getattr(b, "type", None) == "text").strip()
    return read_verdict(text, out.stop_reason)


def tally(rows: list[dict]) -> dict:
    out: dict = {}
    for left, right in JUDGE_PAIRS:
        pair = f"{left}-{right}"
        mine = [r for r in rows if r["pair"] == pair]
        judged = [r for r in mine if not r["identical"]]
        lw = sum(r["winner"] == "left" for r in judged)
        rw = sum(r["winner"] == "right" for r in judged)
        out[pair] = {"left": left, "right": right, "n": len(mine), "identical": len(mine) - len(judged),
                     "left_win": lw, "right_win": rw, "tie": sum(r["winner"] == "=" for r in judged),
                     "judge_fail": sum(r["winner"] is None for r in judged),  # 0 이 아니면 승패로 읽지 말 것
                     "sign_p": round(sign_test_p(lw, rw), 4)}
    return out


def judge(repeat: int) -> None:
    """A(현행 반경 순서)·B(섞인 순서)·B3 상위 목록을 사례마다 결정론으로 만들고(위 `measure` 그대로 — 운영 핸들러 대조까지),
    판정 모델이 순서를 모른 채 짝마다 비교한다. 자리(A/B)는 사례 이름 시드로 뒤집는다. 판정 출력은 평가에만 쓴다(학습 금지, 2026-09-08)."""
    if not JUDGE.startswith("claude"):
        raise SystemExit(f"판정 모델은 Claude 만 — EVAL_JUDGE_MODEL={JUDGE!r}")
    key = os.environ.get("ANTHROPIC_API_KEY")  # 환경 변수로만 — 파일·로그인 프로필에서 읽지 않는다
    if not key:
        raise SystemExit("ANTHROPIC_API_KEY 환경 변수가 없다 — 판정은 실 Claude 호출이다(사용자 승인 뒤에만)")
    import anthropic

    from measure_prompt_ab import _run

    client = anthropic.Anthropic(api_key=key, max_retries=1)
    dh._FANOUT_SQL_CAP_S = 120.0  # `main` 註와 같다 — 운영 핸들러 대조의 시한만 푼다
    kn = _Knowledge()
    emb = CachingEmbedding(kn.emb)
    builder = CandidatePoolBuilder(StaticPoiDb(tuple(_pois())), M7Config())
    index = hr.chunk_index()
    corpus = _Corpus(kn)
    picks = tuple(filter(None, os.environ.get("EVAL_CASES", "").split(",")))
    built, mismatch = [], 0
    for case in CASES:
        if picks and not case[0].startswith(picks):
            continue
        keep: dict = {}
        mismatch += measure(case, builder, emb, corpus, index, keep)["e2e_mismatch"]
        built.append((case, {k: keep[v] for k, v in JUDGE_ARMS.items()}))
        print(f"built {case[0]}", flush=True)
    if mismatch:
        raise SystemExit(f"운영 핸들러 대조 불일치 {mismatch} — 판정할 목록이 운영 순서가 아니다(중단)")
    jobs = [(case, lists, left, right, rep) for rep in range(repeat) for case, lists in built for left, right in JUDGE_PAIRS]

    def one(item) -> dict:
        _, (case, lists, left, right, rep) = item
        name, utt = case[0], case[3]
        a, b = lists[left], lists[right]
        same = [p.poi_id for p in a] == [p.poi_id for p in b]
        row = {"name": name, "pair": f"{left}-{right}", "rep": rep, "identical": same and left != right,
               "lists": {left: [p.name for p in a], right: [p.name for p in b]}}
        if row["identical"]:
            return {**row, "winner": "=", "why": "두 목록이 같다 — 판정하지 않음"}
        flip = random.Random(f"{name}|{rep}").random() < 0.5  # 사례 이름 시드 — 다시 돌려도 같은 자리
        shown = (b, a) if flip else (a, b)
        got, why = _ask_judge(client, judge_prompt(utt, *shown, kn))
        side = None if got is None else "=" if got == "=" else ("left" if (got == "A") != flip else "right")
        return {**row, "flip": flip, "winner": side, "why": why}

    rows = _run(one, jobs)
    summary = {"judge": JUDGE, "repeat": repeat, "cases": len(built), "pairs": tally(rows)}
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    for r in sorted(rows, key=lambda r: (r["pair"], r["name"], r["rep"])):
        mark = {"left": "<", "right": ">", "=": "=", None: "!"}[r["winner"]]
        print(f" {mark} {r['pair']:<5} {r['name']:<14} #{r['rep']} {r['why']}")
    out = os.environ.get("EVAL_OUT")
    if out:
        Path(out).write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "judge":
        judge(int(sys.argv[2]) if len(sys.argv) > 2 else 1)
    else:
        main()
