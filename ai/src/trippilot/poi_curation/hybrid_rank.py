"""KB-5 열린 검색의 순위 재료 — 질의 낱말 게이트 · 범위 안 BM25(글자 2-gram) · 문서 순위(RRF) · 규칙 순위와의 융합(RRF).

**왜.** 도우미 장소 탐색·추천의 후보 순서는 규칙 정렬(`dialogue_handlers._explore_rank` — 주제 낱말이 태그·이름에 든 수 → 인기 →
저장 수 …)이 정한다. "조용한 북카페"·"비 오는 날 실내"처럼 태그·이름에 없는 묘사는 그 정렬이 못 읽는다. KB-5 조각(위키·관광공사
개요)은 그 묘사를 담고 있지만, 지금은 "닫힌 후보 안에서 장소마다 맞는 조각 하나 고르기"(`place_knowledge`)에만 쓰인다.

**11-02 실패를 되풀이하지 않는 두 장치**(다시 짜기 '문서 몫' #1796 — 순수 임베딩이 비 오는 날에 숭례문·용두암, 북카페에 라멘집을 냈다):
1. **키워드 근거 문턱** — 범위 안 BM25 가 0 인 장소는 문서 순위에 아예 들지 않는다. 임베딩은 근거가 있는 장소들 사이의 순서만 가른다.
2. **규칙 순위가 바닥** — 최종 순서는 규칙 순위 전체와 문서 순위의 RRF 다. 문서가 없는 장소도 제 규칙 자리를 지키고, 출력은 언제나
   입력의 순열이다(INV-1 — 새 장소를 들이지 않는다).

**게이트** — 주제에서 일반 형용사·요청 꼴 말(가볼·만한·추천·근처·곳…)·지역 이름·종류 낱말을 뺀 낱말이 하나라도 남아야 연다
("서울 가볼 만한 곳"·"부산 맛집"·"제주 카페 추천"은 닫힌다 — 규칙 정렬 그대로). 테마 태그로 이미 잇는 속성 낱말(조용·아이랑 —
`theme_tags`)은 BM25 낱말에 남기되, 게이트를 여는지는 변형으로 고른다(G1: 열지 않는다 · G2: 연다). BM25 항에는 종류 이름을 넣지 않는다
("카페"를 넣으면 범위의 거의 모든 카페 조각이 근거를 갖는다) — 낱말로도("카페들"·"쇼핑하기"), 합성어 안의 2-gram 으로도("북카페"의 '카페',
`bm25_terms`). 임베딩 질의 = 남은 낱말 + 종류 한글명.

**기본 꺼짐** — `TRIPPILOT_KB5_OPEN_SEARCH=on` 일 때만 배선이 검색기를 붙인다(`place_fallback.SWITCH` 와 같은 꼴). 이 모듈은 표준
라이브러리와 내부 모듈만 쓴다(`tests/test_architecture.py` poi_curation 순수성).
"""

from __future__ import annotations

import gzip
import json
import logging
import math
import os
import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from trippilot.domain.poi.poi import Poi
from trippilot.domain.poi.region_centers import bare_region, plain_region
from trippilot.domain.poi.theme_tags import _COMPILED as _THEME_PHRASES

log = logging.getLogger(__name__)

SWITCH = "TRIPPILOT_KB5_OPEN_SEARCH"
_DATA = Path(__file__).resolve().parents[3] / "data"
# 조각으로 적재되는 출처의 미리 계산 벡터 머리 — 조각 id 목록이 여기 있다(`chunking.dump_chunk_vectors`)
VECTOR_HEADS = (_DATA / "place_corpus_overview.vectors.json.gz", _DATA / "place_corpus_wiki.vectors.json.gz")

RRF_K = 60
W_DOC = 1.0  # 문서 순위의 무게 — 결정론 측정(`measure_assistant_open_search.py`)이 {0.5, 1.0} 을 잰다
BM25_K1, BM25_B = 1.2, 0.75
GATES = ("G1", "G2")


def enabled() -> bool:
    return os.environ.get(SWITCH, "off").strip().lower() in ("on", "1", "true", "yes")


# ── 조각 id 표 ────────────────────────────────────────────────────────────────


def read_index(paths: Iterable[Path]) -> dict[str, tuple[str, ...]]:
    """벡터 머리의 `ids` 만 읽어 {source_ref: 실재 조각 id} — fp16 본체는 읽지 않는다(머리는 합쳐 0.7MB). 파일 장애는 그 파일 몫만
    빈다(부가 정보라 없이 간다, INV-4 — 사유는 로그)."""
    out: dict[str, list[str]] = defaultdict(list)
    for path in paths:
        try:  # id 를 펼치는 데까지 — `ids` 가 null·문자열이 아닌 값이어도 그 파일 몫만 빈다
            head = json.loads(gzip.decompress(Path(path).read_bytes()))
            pairs = [(i.split(":", 1)[-1].split("#", 1)[0], i) for i in head["ids"]]
        except Exception as e:  # noqa: BLE001 — 깨진 머리 하나가 탐색을 막으면 안 된다
            log.warning("kb5 open search index unavailable %s: %s", Path(path).name, type(e).__name__)
            continue
        for ref, i in pairs:
            if ref:
                out[ref].append(i)
    return {ref: tuple(ids) for ref, ids in out.items()}


@lru_cache(maxsize=1)
def chunk_index() -> Mapping[str, tuple[str, ...]]:
    """{source_ref(TourAPI contentid): 그 장소의 실재 조각 id들} — 출처 둘(관광공사 개요·위키) 합본, 파일 순서 그대로.

    **청킹 전 통문서 id(`{출처}:{ref}`)와 조각으로 싣지 않는 출처(intro·heritage)는 빠진다** — `place_knowledge` 는 그 통문서도 같이
    펼치지만(배포 롤아웃 창 방어) 열린 검색은 조각만 본다. 조각이 아직 안 들어온 장소는 문서가 없는 장소로 간다(규칙 자리 그대로).
    `chunk_ids()` 처럼 상한(40)까지 펼치지 않는 이유: 범위가 수백 곳이라 펼치면 id 가 수만 개가 된다 — 실재 id 만 넘긴다."""
    return read_index(VECTOR_HEADS)


# ── 질의 낱말 · 게이트 ──────────────────────────────────────────────────────────

_WORD = re.compile(r"[가-힣A-Za-z]{2,}")
# 요청 꼴 말 — 무엇을 찾는지가 아니라 찾아 달라는 말·찾는 자리·인기 신호(인기·많은은 규칙 정렬의 '요즘 인기' 태그·저장 수가 이미 읽는다).
# 낱말 안의 조각으로 지운다("가볼만한곳"·"북카페추천"). '데'는 '갈 데' 꼴만 — 데이트를 지우지 않게.
# 리뷰(2026-11-04)로 더한 꼴 — 낱말 안 조각만 지우면 남는 꼬리가 게이트를 열었다: "핫플레이스"의 '레이스' · "먹을 만한"·"들를 곳"의
# '먹을'·'들를'(을·를 받침 꼴 — 앞 한 글자는 낱말이 못 된다) · "인기 많은"·"볼거리 많은"의 '많은' · "어디 갈까"의 '갈까'
_REQUEST = re.compile(
    r"가\s?볼|[갈볼놀할먹쉴들을를]\s?만한|만한|추천|근처|주변|장소|알려|찾아|보여|골라|해\s?줘|해\s?주|주세요|줄래|있을까|있어|있나|있는"
    r"|어디|요즘|핫한|핫플(?:레이스)?|인기|유명|많은|많고|많이|가기|군데|하나|먹을(?:거리)?|[갈볼할놀쉴]\s?(?:까|래)"
    r"|[갈놀할먹쉴볼을를]\s?(?:곳|데)(?![가-힣])|곳")
# 종류 낱말 — 분류의 `category` 가 이미 고른 축(풀 필터)이라 근거 낱말로 쓰지 않는다. 조사가 붙어도 같다
_KIND_WORDS = frozenset({
    "명소", "맛집", "카페", "야경", "자연", "쇼핑", "문화", "액티비티", "미술", "술집", "식당", "음식점", "밥집", "관광지", "관광",
    "관광명소", "볼거리", "먹거리", "놀거리", "구경", "커피숍", "레스토랑",
})
_JOSA = re.compile(r"(?:이랑|랑|에서|으로|로|에|을|를|이|가|은|는|도|만|의|과|와|하고)$")
# 합성어 안에서 종류 이름이 차지한 2-gram — BM25 항에서 뺀다(`bm25_terms`)
_KIND_RX = re.compile("|".join(sorted(map(re.escape, _KIND_WORDS), key=len, reverse=True)))
_KIND_TAILS = tuple(sorted(_KIND_WORDS))
# BM25 낱말의 끝 — 2-gram 이 말뜻에 맞게 뗀다(결정론 측정 1회차, 2026-11-04: 끝을 안 떼면 '산책하기'의 2-gram '하기'가 개요 거의 전부에
# 걸려 생선찜집이 "산책하기 좋은 숲길"의 근거를 가졌고, '아이랑'의 '이랑'·'오는데'의 '는데'도 같은 꼴이었다).
# - 동사 꼴(하기·하는·할·는데·는)은 늘 뗀다 — 남는 말이 한 글자면 낱말이 빠진다("비 오는 날"의 '오는'이 빈말로 게이트를 열지 않게)
# - 조사는 남는 말이 두 글자 이상일 때만 뗀다("아이랑"→아이 · "실내로"→실내). '이'·'가'는 떼지 않는다(구이·놀이·휴가)
# - 형용사 관형형(한·운·은·인)은 남는 말이 두 글자 이상일 때만("조용한"→조용 · "매운"·"작은"은 그대로 — 2-gram 이 남게)
_VERB_ENDS = ("하기", "하는", "는데", "는", "할")
_JOSA_ENDS = ("이랑", "에서", "으로", "하고", "랑", "와", "을", "를", "에", "로", "의")
_ADJ_END = ("한", "운", "은", "인")


@dataclass(frozen=True, slots=True)
class OpenQuery:
    """게이트를 연 질의. `words` = BM25 낱말(관형형 끝을 뗀 꼴), `text` = 임베딩 질의(남은 낱말 원형 + 종류 한글명)."""

    words: tuple[str, ...]
    text: str


def _stem(word: str) -> str:
    verb = next((e for e in _VERB_ENDS if word.endswith(e)), None)
    if verb is not None:
        return word[:-len(verb)]
    # 종류 이름으로 끝나면 조사로 보지 않는다 — "북레스토랑"의 '랑'을 떼면 '레스토'가 남아 종류 이름 2-gram 이 BM25 항으로 샜다(PBT)
    josa = None if word.endswith(_KIND_TAILS) else next(
        (e for e in _JOSA_ENDS if word.endswith(e) and len(word) - len(e) >= 2), None)
    if josa is not None:
        word = word[:-len(josa)]
    return word[:-1] if word.endswith(_ADJ_END) and len(word) >= 3 else word


def _is_kind(word: str) -> bool:
    """종류 낱말인가 — 조사·복수 '들'이 붙어도("카페를"·"관광지들"·"카페들을") 같다. 끝 뗀 꼴("쇼핑하기"→쇼핑)은 호출측이 한 번 더 묻는다."""
    bare = _JOSA.sub("", word)
    return any(w in _KIND_WORDS or (w.endswith("들") and w[:-1] in _KIND_WORDS) for w in (word, bare))


def _blank(text: str, rx: re.Pattern) -> str:
    """일치를 같은 길이의 공백으로 — 자리가 그대로여서 속성 구절(테마 태그 정규식)의 자리와 겹치는지 볼 수 있다."""
    return rx.sub(lambda m: " " * len(m.group()), text)


def open_query(text: str | None, category_ko: str | None = None, *, generic: Iterable[str] = (),
               gate: str = "G1") -> OpenQuery | None:
    """주제(또는 지역을 뺀 발화) → 게이트가 열리면 `OpenQuery`, 닫히면 None.

    `generic` 은 호출측의 일반 형용사 표(도우미 `_GENERIC_WORDS` — 이름 적중에서 빼는 말과 같은 한 벌을 넘긴다)."""
    if gate not in GATES:
        raise ValueError(f"gate 는 {GATES} 중 하나: {gate!r}")
    if not text or not text.strip():
        return None
    blanked = _blank(text, _REQUEST)
    for g in generic:
        blanked = blanked.replace(g, " " * len(g))
    spans = [m.span() for rx in _THEME_PHRASES.values() for m in rx.finditer(text)]
    kept: list[tuple[str, str, bool]] = []  # (원형, 어간, 속성 낱말인가)
    for m in _WORD.finditer(blanked):
        word = m.group()
        stem = _stem(word)
        # 끝 뗀 꼴도 본다 — "쇼핑하기 좋은"·"구경하는"·"명소인"이 종류 낱말 하나로 게이트를 열었다(리뷰 2026-11-04)
        if bare_region(word) is not None or plain_region(word) is not None or _is_kind(word) or _is_kind(stem):
            continue
        if len(stem) < 2:
            continue
        prop = any(a < m.end() and m.start() < b for a, b in spans)
        kept.append((word, stem, prop))
    opener = [w for w, _, prop in kept if gate == "G2" or not prop]
    if not opener:
        return None
    words = tuple(dict.fromkeys(stem for _, stem, _ in kept))
    query = " ".join(dict.fromkeys(w for w, _, _ in kept))
    return OpenQuery(words, f"{query} {category_ko}" if category_ko else query)


# ── BM25 (범위 안 조각) ─────────────────────────────────────────────────────────

_TOKEN = re.compile(r"[가-힣a-z0-9]+")


def bigrams(text: str) -> list[str]:
    """글자 2-gram — 띄어쓴 낱말 안에서만(낱말 사이를 잇지 않는다). 한 글자 낱말은 없다."""
    return [tok[i:i + 2] for tok in _TOKEN.findall(text.lower()) for i in range(len(tok) - 1)]


def _doc_text(hit) -> str:
    """색인할 글 — **제목(장소·문서 이름)은 뺀다**. 이름 글자가 질의 낱말에 걸리면 위치가 아니라 이름을 읽는 꼴이 된다
    (NL2SQL 이 '홍대'에 천안홍대용과학관을 냈다, 2026-10-21)."""
    title = (hit.metadata or {}).get("title") or ""
    return hit.text.replace(title, " ") if title else hit.text


def bm25_terms(words: Sequence[str]) -> frozenset[str]:
    """BM25 항 = 낱말의 글자 2-gram 중 **합성어 안 종류 이름 자리의 2-gram 을 뺀 것**("북카페" → 북카 · '카페'는 빠진다 · "근대거리"의
    '거리'는 남는다 — 종류 이름 '볼거리'가 거기 없다). 빼지 않으면 '카페' 하나로 범위의 카페 조각 거의 전부가 근거를 얻어 문턱이 꺼졌다
    (리뷰 2026-11-04 — 서울/북카페 근거 45곳 중 42곳이 '카페' 2-gram 뿐)."""
    terms: set[str] = set()
    for tok in (t for w in words for t in _TOKEN.findall(w.lower())):
        inside = {i for m in _KIND_RX.finditer(tok) for i in range(m.start(), m.end() - 1)}
        terms.update(tok[i:i + 2] for i in range(len(tok) - 1) if i not in inside)
    return frozenset(terms)


def bm25_scores(hits: Sequence, words: Sequence[str]) -> dict[str, float]:
    """{poi_ref: 그 장소 조각들의 BM25 최댓값} — IDF 는 이 범위(넘겨받은 조각들) 안에서, Lucene 꼴 log(1 + (N−n+0.5)/(n+0.5))
    (늘 양수). 장소 점수는 조각 점수의 **합이 아니라 최댓값**이다 — 조각이 많은 장소(위키 40조각)가 길이로 이기지 않게.
    항은 `bm25_terms` — 종류 이름 2-gram 은 근거가 아니다(키워드 근거 문턱이 그것으로 켜지지 않게)."""
    terms = bm25_terms(words)
    docs = [(h.poi_ref, bigrams(_doc_text(h))) for h in hits if h.poi_ref]
    if not docs or not terms:
        return {}
    n = len(docs)
    avgdl = sum(len(d) for _, d in docs) / n or 1.0
    df = Counter(t for _, d in docs for t in set(d) & terms)
    idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}
    best: dict[str, float] = {}
    for ref, d in docs:
        tf = Counter(x for x in d if x in idf)
        norm = BM25_K1 * (1 - BM25_B + BM25_B * len(d) / avgdl)
        score = sum(idf[t] * f * (BM25_K1 + 1) / (f + norm) for t, f in tf.items())
        best[ref] = max(best.get(ref, 0.0), score)
    return best


def embedding_scores(hits: Sequence) -> dict[str, float]:
    """{poi_ref: 그 장소 조각들의 유사도 최댓값}."""
    best: dict[str, float] = {}
    for h in hits:
        if h.poi_ref:
            best[h.poi_ref] = max(best.get(h.poi_ref, -math.inf), h.score)
    return best


def ranks(scores: Mapping[str, float], order: Mapping[str, int]) -> dict[str, int]:
    """점수 → 1부터의 순위. 동점은 규칙 순서(`order`), 규칙 순서 밖은 뒤로 — 결정론."""
    keyed = sorted(scores, key=lambda r: (-scores[r], order.get(r, len(order)), r))
    return {r: i for i, r in enumerate(keyed, 1)}


def doc_rank(hits: Sequence, words: Sequence[str], order: Mapping[str, int]) -> dict[str, int]:
    """{source_ref: 문서 순위} = RRF(BM25 순위, 임베딩 순위) — **BM25 > 0 인 장소만**(키워드 근거 문턱). 근거가 없으면 빈 표."""
    bm = {r: s for r, s in bm25_scores(hits, words).items() if s > 0 and r in order}
    if not bm:
        return {}
    emb = embedding_scores(h for h in hits if h.poi_ref in bm)
    r_bm, r_emb = ranks(bm, order), ranks(emb, order)
    fused = {r: 1 / (RRF_K + r_bm[r]) + 1 / (RRF_K + r_emb[r]) for r in bm}
    return ranks(fused, order)


def fuse(rule_sorted: Sequence[Poi], doc: Mapping[str, int], w_doc: float = W_DOC) -> list[Poi]:
    """최종 순위 = RRF(규칙 순위 전체, 문서 순위 × `w_doc`), k=60. 동점은 규칙 순서. **출력은 입력의 순열**이다(INV-1) — 문서 순위에
    없는 장소는 규칙 점수만 갖고, 그들끼리의 순서는 규칙 순서 그대로다. 문서 순위가 비면 항등."""
    if not doc:
        return list(rule_sorted)

    def score(i: int, p: Poi) -> float:
        d = doc.get(p.source_ref or "")
        return 1 / (RRF_K + i + 1) + (w_doc / (RRF_K + d) if d is not None else 0.0)

    scored = sorted(((score(i, p), i, p) for i, p in enumerate(rule_sorted)), key=lambda t: (-t[0], t[1]))
    return [p for _, _, p in scored]
