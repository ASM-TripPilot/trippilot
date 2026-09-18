"""재계획 지시 사전(KB-4) — 칩 조회와 자유 입력 번역 (ai-backend-replan-연동-설계.md §3).

## 두 통로, 한 사전

    칩 선택  → `resolve_chips`      키 그대로 조회. 벡터를 안 탄다 (0ms)
    자유 입력 → `match_free_text`   alias 임베딩 매칭 → 키

사전이 FE 칩(7종)보다 넓은 것은 **의도된 분업**이다 — 칩에 없는 지시는 말로 닿는다.
AI 가 모르는 키는 버리지 않고 `unknown` 으로 되돌린다: FE 가 칩을 늘렸는데 AI 가
안 따라온 상황이 **로그가 아니라 응답에서** 드러나야 한다(조용한 무시 금지, INV-4 취지).

## `enforced_by` — 누가 집행하는가

모델이 받는 후보 줄은 `poi_id | 카테고리 | 상호명` 뿐이다. 그래서 지시마다 집행 주체가
갈린다: `PROMPT`(카테고리로 모델이) · `RANKING`(코드가 거리로) · `SOLVER`(어셈블리).
이 구분이 없으면 "모델이 못 보는 축으로 고르라"는 지시를 쓰게 되고 모델은 상호명
기억으로 지어낸다 — KB-3 초안 41건 중 28건을 뺀 이유와 같다.

`SOLVER` 는 **아직 배선되지 않았다**(A-4). `unwired=True` 로 드러내고, 소비 측이
"인식했지만 효과 없음"을 구분할 수 있게 한다.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

from trippilot.domain.kb import KbDocument, KbKind
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.vector_store_port import VectorStorePort

from trippilot.agents.planb.kb_retrieval import KbLoadError, retrieve

# 자유 입력 매칭 임계 — **실측으로 정했다** (2026-09-12, KURE-v1 × 실 pgvector,
# 정답 발화 23건 · 비지시 8건, 재현: `scripts/measure_directive_match.py`).
#
# IntentRouter 의 질문뱅크 임계(`t_high=0.82`)를 그대로 쓰려 했다가 실측에서 뒤집혔다 —
# 0.82 는 정답 10건을 놓친다("천천히 여유있게" 0.787, "맛집+카페" 0.790 처럼 **1위가
# 정답인데** 컷). 두 매칭은 성격이 달라서다: 질문뱅크는 한 문장이 한 의도를 가리키지만,
# 지시 발화는 한 문장에 여럿이 섞이고("비도 오고 걷기도 싫어") 표현이 더 흩어진다.
#
#   임계  정확일치  부분누락  과다선택  오검출(비지시)
#   0.70   15/23      1        7        0/8
#   0.72   19/23      1        3        0/8
#   0.74   18/23      2        3        0/8   ← 채택
#   0.76   18/23      3        2        0/8
#   0.82   13/23     10        0        0/8
#
# 잡음 최고점 0.645("오늘 날씨가 참 좋네요"), 정답 하한 0.751 — 사이가 넉넉하다.
# `정확일치 ≥ 18 ∧ 과다선택 ≤ 3` 구간 [0.72, 0.76] 의 **가운데**를 골랐다. 0.72 가
# 수치는 더 좋지만 과다선택이 7로 튀는 0.70 에서 0.02 밖이라, 사전이 조금만 늘어도
# 넘어간다. **부분누락은 LLM 워커(A-3)가 받지만 과다선택은 아무도 안 막는다** —
# 사용자가 말하지 않은 방향으로 후보가 틀어지는 쪽이 더 나쁘다.
#
# 한계: 평가 발화 31건을 사람이 썼다. 실사용 발화가 쌓이면 그것으로 다시 잰다.
DEFAULT_MATCH_THRESHOLD = 0.74
# 한 발화에 지시가 여럿 실릴 수 있다("실내로 하고 이동도 줄여줘") — 상위 몇 개까지 볼지.
DEFAULT_MATCH_TOP_K = 6
# 한 발화에서 뽑을 지시 수 상한. 넘치면 프롬프트가 모순 지시로 채워진다.
MAX_RESOLVED = 4

ENFORCED_BY = ("PROMPT", "RANKING", "SOLVER")


@dataclass(frozen=True, slots=True)
class DirectiveSpec:
    """지시 1종. `aliases` 는 각각 따로 임베딩된다 — 합치면 개별 표현의 신호가 희석된다."""

    key: str
    label: str
    enforced_by: str
    aliases: tuple[str, ...]
    prefer_categories: tuple[str, ...] = ()
    avoid_categories: tuple[str, ...] = ()
    unwired: bool = False

    def __post_init__(self) -> None:
        if not self.key:
            raise ValueError("DirectiveSpec.key 는 비어있을 수 없음")
        if not self.label.strip():
            raise ValueError(f"{self.key}: label 이 비어있음")
        if self.enforced_by not in ENFORCED_BY:
            raise ValueError(f"{self.key}: enforced_by 는 {ENFORCED_BY} 중 하나")
        # PROMPT 인데 카테고리가 없으면 모델에게 줄 판별 축이 없다 — 지시가 무력해진다.
        if self.enforced_by == "PROMPT" and not (
            self.prefer_categories or self.avoid_categories
        ):
            raise ValueError(f"{self.key}: PROMPT 는 prefer/avoid_categories 가 필요하다")
        # 반대로 PROMPT 가 아닌데 카테고리가 있으면 아무도 안 읽는 값이 된다.
        if self.enforced_by != "PROMPT" and (
            self.prefer_categories or self.avoid_categories
        ):
            raise ValueError(f"{self.key}: PROMPT 가 아니면 카테고리를 두지 않는다")


def load_directives(data: object) -> tuple[DirectiveSpec, ...]:
    """사전 파일 파싱 결과 → DirectiveSpec 목록 (구조·위생 검증).

    형식은 `ai/data/replan_directives.yaml`. 루트 `kb` 가 DIRECTIVE 인지 확인하는 것은
    KB-3 seed 와 같은 취지다 — 라벨과 collection 이 어긋나는 지점을 하나 줄인다.
    """
    root = data if isinstance(data, Mapping) else None
    if root is None:
        raise KbLoadError(f"루트가 매핑이 아님 ({type(data).__name__})")
    try:
        kb = KbKind(root.get("kb"))
    except ValueError as e:
        raise KbLoadError(f"kb 라벨 해석 불가: {root.get('kb')!r}") from e
    if kb is not KbKind.DIRECTIVE:
        raise KbLoadError(f"지시 사전인데 kb 가 {kb.value}")
    entries = root.get("directives")
    if not isinstance(entries, Sequence) or isinstance(entries, str) or not entries:
        raise KbLoadError("directives 가 비어있거나 목록이 아님")

    specs: list[DirectiveSpec] = []
    seen_keys: set[str] = set()
    seen_aliases: dict[str, str] = {}
    for i, entry in enumerate(entries):
        if not isinstance(entry, Mapping):
            raise KbLoadError(f"directives[{i}]: 매핑이 아님")
        key = entry.get("key")
        if not isinstance(key, str) or not key:
            raise KbLoadError(f"directives[{i}]: key 누락")
        if key in seen_keys:
            raise KbLoadError(f"key 중복: {key!r}")
        seen_keys.add(key)
        aliases = entry.get("aliases") or ()
        if not isinstance(aliases, Sequence) or isinstance(aliases, str):
            raise KbLoadError(f"{key}: aliases 는 목록")
        if not aliases:
            # alias 가 없으면 자유 입력이 이 지시에 영영 닿지 못한다 — 칩 전용 지시를
            # 만들 생각이었다면 그 의도를 드러내야 하므로 여기서 막는다.
            raise KbLoadError(f"{key}: aliases 가 비어 자유 입력이 닿을 수 없다")
        for a in aliases:
            if not isinstance(a, str) or not a.strip():
                raise KbLoadError(f"{key}: 빈 alias")
            prev = seen_aliases.get(a)
            if prev is not None:
                # 같은 말이 두 지시를 가리키면 매칭이 그날 운에 따라 갈린다.
                raise KbLoadError(f"alias 중복: {a!r} ({prev} · {key})")
            seen_aliases[a] = key
        try:
            specs.append(
                DirectiveSpec(
                    key=key,
                    label=str(entry.get("label", "")),
                    enforced_by=str(entry.get("enforced_by", "")),
                    aliases=tuple(aliases),
                    prefer_categories=tuple(entry.get("prefer_categories") or ()),
                    avoid_categories=tuple(entry.get("avoid_categories") or ()),
                    unwired=bool(entry.get("unwired", False)),
                )
            )
        except ValueError as e:
            raise KbLoadError(str(e)) from e
    return tuple(specs)


def load_directive_file(path: Path, parse: Callable[[str], object]) -> tuple[DirectiveSpec, ...]:
    """파일 → 지시 목록. yaml 파서 주입은 `load_kb_file` 과 같은 seam."""
    return load_directives(parse(path.read_text(encoding="utf-8")))


def directive_documents(specs: Sequence[DirectiveSpec]) -> tuple[KbDocument, ...]:
    """지시 목록 → 적재용 KB 문서. **alias 하나가 문서 하나**다.

    라벨도 문서로 넣는다 — 사용자가 칩 문구를 그대로 치는 경우("실내로")가 흔하다.
    `doc_id` 는 `dir-{key}-{n}` 로 안정적이라 재적재가 멱등하다(upsert).
    """
    docs: list[KbDocument] = []
    for spec in specs:
        for n, text in enumerate((spec.label, *spec.aliases)):
            docs.append(
                KbDocument(
                    kb=KbKind.DIRECTIVE,
                    doc_id=f"dir-{spec.key}-{n:02d}",
                    text=text,
                    poi_ref=None,
                    metadata={"key": spec.key, "enforced_by": spec.enforced_by},
                )
            )
    return tuple(docs)


def index_of(specs: Sequence[DirectiveSpec]) -> Mapping[str, DirectiveSpec]:
    """key → spec 조회표 (칩 경로)."""
    return MappingProxyType({s.key: s for s in specs})


def resolve_chips(
    keys: Iterable[str], specs: Sequence[DirectiveSpec]
) -> tuple[tuple[DirectiveSpec, ...], tuple[str, ...]]:
    """칩 키 → (아는 지시, 모르는 키). 벡터를 안 탄다.

    모르는 키를 **버리지 않고 돌려주는 것**이 이 함수의 절반이다 — FE 가 칩을 늘렸는데
    사전이 안 따라온 상황이 응답에 드러나야 한다. 입력 순서를 보존하고 중복은 접는다.
    """
    table = index_of(specs)
    known: list[DirectiveSpec] = []
    unknown: list[str] = []
    seen: set[str] = set()
    for key in keys:
        if key in seen:
            continue
        seen.add(key)
        spec = table.get(key)
        (known.append(spec) if spec is not None else unknown.append(key))
    return tuple(known), tuple(unknown)


def match_free_text(
    text: str,
    specs: Sequence[DirectiveSpec],
    embedding: EmbeddingPort,
    store: VectorStorePort,
    *,
    top_k: int = DEFAULT_MATCH_TOP_K,
    threshold: float = DEFAULT_MATCH_THRESHOLD,
    max_resolved: int = MAX_RESOLVED,
) -> tuple[DirectiveSpec, ...]:
    """자유 입력 → 지시 목록. 검색 실패는 예외가 아니라 빈 결과다 (INV-4).

    한 발화에 지시가 여럿일 수 있어("실내로 하고 이동도 줄여줘") top-k 를 보되,
    **임계 미달은 버린다** — 닮지 않은 것을 억지로 고르면 사용자가 말하지 않은 방향으로
    후보가 틀어진다. 전건 미달이면 빈 결과이고, 그때는 LLM 워커가 받는다(A-3).

    같은 key 의 alias 가 여럿 걸리면 첫(=최고점) 것만 남긴다 — 점수는 이미 정렬돼 있다.
    """
    if not text.strip() or top_k <= 0 or max_resolved <= 0:
        return ()
    table = index_of(specs)
    try:
        hits = retrieve(KbKind.DIRECTIVE, text, embedding, store, top_k=top_k)
    except Exception:
        # 임베딩·스토어 장애로 재계획을 죽이지 않는다 — 칩 선택분은 그대로 살아 있다.
        return ()
    resolved: list[DirectiveSpec] = []
    seen: set[str] = set()
    for hit in hits:
        if hit.score < threshold:
            continue
        key = (hit.metadata or {}).get("key")
        if not isinstance(key, str) or key in seen:
            continue
        spec = table.get(key)
        if spec is None:
            # 적재된 문서가 사전에 없는 키를 가리킨다 = 사전을 줄이고 재적재를 안 한 상태.
            # 조용히 쓰지 않는다(collection 오염 방어와 같은 취지).
            continue
        seen.add(key)
        resolved.append(spec)
        if len(resolved) >= max_resolved:
            break
    return tuple(resolved)
