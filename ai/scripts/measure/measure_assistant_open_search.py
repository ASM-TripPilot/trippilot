r"""도우미 장소 탐색 열린 검색(KB-5 문서 순위, `place_search` + `hybrid_rank`) — 결정론 측정(LLM 0, 승인 불필요).

실행(ai/ 에서 — 로컬 서빙 임베딩 컨테이너만 부른다, 실 LLM·외부 API 0):
    TRIPPILOT_EMBEDDING_BASE_URL=http://localhost:8100 uv run python scripts/measure/measure_assistant_open_search.py
    EVAL_CASES=서울/비,제주/비 … 로 사례를 고른다(이름 앞부분 일치). 결과 JSON 은 `EVAL_OUT` 경로에도 쓴다.

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
인메모리 스토어의 검색 시간은 pgvector 와 무관하다 — 시한·지연은 3단계(실 스택)에서 잰다.

**2026-11-04 결정론 측정 결론 — B 가 명백한 오답을 줄였다 → 2단계(유료 쌍대 판정)로 갈 가치가 있다.** 37사례(도시 10 × 날씨·분위기·
동반·주제·개수형 30 + 대조군 3 + 11-02 겨눔 4), 오답 판정이 있는 17사례:
- 오답 합계 A 16 → **B(w=1.0·G1·Q1) 9**(줄어든 사례 4 · 늘어난 사례 1) · B(w=0.5) 13(4 → 3 · 늘어남 0) · B1 문서만 9(늘어남 0) ·
  B3 임베딩만 8(늘어남 1 — 겨눔/제주비). 줄어든 몫은 거의 **비·실내**다 — 게이트가 열린 비 사례 7개에서 A 10 → B 2(서울: 낙산공원·
  북악스카이 팔각정 → 서울시립미술관·세종문화회관 · 부산: 광안리해수욕장·황령산 → 부산문화회관·카페). 아이 동반(술집)은 규칙 정렬이 이미
  나이트라이프를 빼 모든 팔이 0 — 이 판정으로는 아무것도 못 가른다.
- **늘어난 1건(겨눔/북카페, 종류를 안 정한 "조용한 북카페")은 반쯤 판정 탓이다** — B 가 올린 북파크라운지는 개요가 "프리미엄 북카페"인데
  분류가 CULTURE 라 오답으로 셌다. 진짜 오답은 서대문 안산(자연 — 개요에 "북카페와 전망지가 있는" 숲길)이다. 종류를 CAFE 로 받은
  "서울 조용한 북카페"·"성수 조용한 북카페"는 두 팔 모두 0 이고 B 만 순서가 바뀐다.
- **11-02 겨눔의 날씨 둘("비 오는 날" — 서울·제주)은 게이트가 닫혀 B = A** 다(묘사 낱말이 '비' 한 글자뿐). 고치려면 날씨 말 확장(비 →
  실내, 계획 8(d))이 따로 필요하다. B3 는 같은 말에 레인리포트 경리단(이름이 '비')·채석장 전망대를 올렸다 — 11-02 실패가 재현된다.
- **B3 는 오답 수만 낮고 쓸 수 없다** — A 와의 겹침 @5 0.29(B 1.94), 대조군 셋의 순서를 전부 바꾼다(B·B1 은 대조군 바이트까지 같다).
- **문서 보유율**(상위 목록 중 KB-5 조각이 있는 곳) A 0.53 → B 0.81 · B1 0.85 · B3 1.00 — 근거 문턱 때문에 문서가 있는 곳만 오를 수
  있어서다(설계상 편향). 유료 판정은 두 팔 모든 장소에 같은 참고 설명을 주고 "설명 없음은 부적합이 아님"을 명시해야 한다(계획 3단계).
- **게이트**: G1·Q1 열림 28/34, 대조군 0/3, 열린 사례 중 NO_EVIDENCE 0(2-gram BM25 > 0 은 쉽게 찬다 — 문턱은 '근거 없음'을 가르지
  못하고 순위의 바닥 역할만 한다). G2 는 4사례를 더 연다(속성 낱말만 — 아이랑·바다 보이는·조용한 작업) — 오답 차이 0, 순서만 더 흔든다
  → **G1**. Q2(지역을 뺀 발화)는 '쉬고·싶어·가지' 같은 빈말이 낱말에 남아 Q1 보다 나을 것이 없다 → **Q1**. 무게는 **w=1.0**(0.5 는 비 오답을
  10 → 7 만 줄인다).
- **범위 크기**: 규칙 정렬을 지난 장소 p50 370 · p95 3,805, 그중 조각이 있는 곳 p50 122 · p95 541, 조각 id p50 246 · p95 2,077
  → `place_search.MAX_IDS` 2,100(측정 사례는 안 잘린다).
- **출처 충돌**: 관광공사가 아닌 POI 의 원천 id 가 관광공사 contentid 와 같은 경우 0. 조각 표에 제 id 로 든 Overture 66·카카오 16 은
  위키 수집이 그 장소 id 로 적재한 같은 장소의 문서다(`_collisions` 註).
- 운영 핸들러 대조 `e2e_mismatch` 0(37/37) · 코퍼스 조각과 벡터 머리 불일치 0.
- 1회차(2-gram 끝 떼기 전)와 G1·Q1 오답 수는 같았다(Q2 는 10 → 9). 바뀐 것은 판정 밖 사례의 순서다 — '산책하기'의 '하기'가 생선찜집 개요에 걸렸고
  ('강릉/숲길'), Q2 의 '오는데'가 빈말로 게이트를 열었다(`hybrid_rank._VERB_ENDS` 註).
"""

from __future__ import annotations

import json
import os
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
    # 대조군 — 게이트가 닫혀야 한다(B = A, 바이트까지)
    ("대조/서울", _EX, {"region": "서울", "theme": "가볼 만한"}, "서울 가볼 만한 곳", None),
    ("대조/부산", _EX, {"region": "부산", "category": "FOOD", "theme": "맛집"}, "부산 맛집", None),
    ("대조/제주", _EX, {"region": "제주", "category": "CAFE", "theme": "카페 추천"}, "제주 카페 추천", None),
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


def measure(case, builder, emb, corpus, index) -> dict:
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
    runs = anchor.kind in ("region", "itinerary") and not night  # 운영 `_open_query` 와 같은 조건(이어 묻기 사례는 없다)
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
    def e2e(searcher) -> tuple[list[str], str | None]:
        ports = HandlerPorts(pool_builder=builder, place_search=searcher)
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

    def stats(rank: list) -> dict:
        return {"names": [p.name for p in rank], "cats": [p.category.value for p in rank],
                "wrong": sum(_wrong(kind, p) for p in rank),
                "docs": sum(1 for p in rank if p.source_ref in index), "n": len(rank)}

    return {"name": name, "kind": kind, "group": name.split("/")[0], "anchor": anchor.label, "pool": len(pool.pois),
            "fits": len(rule), "scope_places": len(all_refs), "scope_ids": len(all_ids), "capped_places": len(scope_refs),
            "capped_ids": len(ids), "variants": variants, "arms": {k: stats(v) for k, v in arms.items()},
            "e2e_status": e2e_status, "e2e_ms": e2e_ms, "e2e_mismatch": mismatch}


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
    out["max_ids"] = ps.MAX_IDS
    return out


def main() -> None:
    dh._DOC_CAP_S = 120.0  # 위 `e2e` 註 — 측정 프로세스 안에서만
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
              f"e2e {r['e2e_status']}·{r['e2e_ms']}ms{' MISMATCH' if r['e2e_mismatch'] else ''} ({time.monotonic() - t:.1f}s)",
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


if __name__ == "__main__":
    main()
