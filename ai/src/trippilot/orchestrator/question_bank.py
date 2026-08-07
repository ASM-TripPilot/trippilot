"""의도 질문뱅크 적재 (intent-matching-design.md §3, ai/data/README.md).

seed 정본은 `ai/data/intent_question_bank.yaml`. 이 모듈은 그 구조를 검증해
`BankEntry`로 만들고(=파싱·위생 검사), `VectorStorePort`에 임베딩과 함께 적재한다.

**검수 게이트 (핵심 판단)**: `ai/data/README.md`는 "검수 완료 전에는 임베딩·뱅크 편입 금지
(`reviewed: false` 유지)"를 규정한다. 따라서 `index_bank`는 `reviewed: false` 항목을 만나면
**명시적 opt-in(`allow_unreviewed=True`) 없이는 적재를 거부하고 예외를 던진다**.
- 조용히 건너뛰지 않는 이유: 미검수 항목을 말없이 빠뜨리면 "뱅크가 실린 줄 알았는데 매칭이 안 되는"
  침묵 실패가 된다 (INV-4 정신). 데이터 상태 오류는 시끄럽게 드러내는 편이 맞다.
- opt-in을 남긴 이유: 오프라인 평가·테스트·검수 도구가 미검수 seed를 실어봐야 한다.
  운영 배선은 기본값(거부)을 그대로 쓰면 규칙이 자동으로 지켜진다.

yaml 파싱 자체는 **주입받는다**(`load_bank_file(path, parse=...)`) — 저장소 규칙상
yaml 파서 의존은 `c1/prompts.py`(프롬프트 정본 포맷) 한정이고 아키텍처 테스트가 이를 강제한다
(`test_yaml_only_imported_in_c1_prompts`). 뱅크 yaml도 같은 예외를 받을지는 정본 개정 사안이라
여기서는 파서를 밖에서 넣는 seam으로 둔다.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from trippilot.domain.intent import ROUTABLE_INTENTS, Intent, RoutingMode, route_for
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.vector_store_port import VectorStorePort

BANK_COLLECTION = "intent_bank"  # 벡터 스토어 collection 3종 중 하나 (EP-8)

# yaml의 mode 표기 → 라우팅 테이블 enum. 표기 차이는 여기서만 흡수한다.
_YAML_MODE: dict[str, RoutingMode] = {
    "Delegate": RoutingMode.DELEGATE,
    "FastPath": RoutingMode.FAST_PATH,
}


class BankLoadError(ValueError):
    """질문뱅크 구조·정합성 위반 — 설정/데이터 버그라 폴백 대상이 아니다."""


class UnreviewedBankError(BankLoadError):
    """검수 전(`reviewed: false`) 항목 편입 시도 (ai/data/README.md 규칙)."""


@dataclass(frozen=True, slots=True)
class BankEntry:
    """질문뱅크 1문장 (intent-matching-design §3.1 IntentBankEntry의 적재 시점 부분집합).

    embedding·hit_count·created_at·active는 저장소(pgvector) 소관이라 여기서 들지 않는다.
    """

    entry_id: str
    intent: Intent
    question: str
    reviewed: bool
    origin: str
    bank_version: str
    slot_pattern: dict  # {슬롯명: "regex:..."} — seed에는 아직 없음(빈 dict)

    def payload(self) -> dict:
        """벡터 스토어 payload — 라우터가 매칭 결과를 해석하는 데 필요한 것만."""
        return {
            "intent": self.intent.value,
            "question": self.question,
            "reviewed": self.reviewed,
            "origin": self.origin,
            "bank_version": self.bank_version,
            "slot_pattern": dict(self.slot_pattern),
        }


def _require_mapping(value: object, where: str) -> Mapping:
    if not isinstance(value, Mapping):
        raise BankLoadError(f"{where}: 매핑이 아님 ({type(value).__name__})")
    return value


def load_bank(data: object) -> tuple[BankEntry, ...]:
    """파싱된 yaml(dict) → 검증된 BankEntry 목록.

    검증 항목: 의도 라벨 closed-set · handler/mode가 라우팅 테이블과 일치 ·
    질문 문자열 비어있음 금지 · 의도 중복 금지 · 문장 완전중복 금지(§3.3 경계 오염 방지의 하한).
    """
    root = _require_mapping(data, "최상위")
    version = root.get("version")
    if not isinstance(version, str) or not version:
        raise BankLoadError("version은 비어있지 않은 문자열이어야 함")
    default_origin = root.get("origin", "seed")
    if not isinstance(default_origin, str) or not default_origin:
        raise BankLoadError("origin은 비어있지 않은 문자열이어야 함")
    groups = root.get("intents")
    if not isinstance(groups, Sequence) or isinstance(groups, (str, bytes)) or not groups:
        raise BankLoadError("intents는 비어있지 않은 목록이어야 함")

    entries: list[BankEntry] = []
    seen_intents: set[Intent] = set()
    seen_questions: dict[str, str] = {}  # question → entry_id (완전중복 검출)
    for idx, raw in enumerate(groups):
        group = _require_mapping(raw, f"intents[{idx}]")
        intent = _parse_intent(group.get("intent"), f"intents[{idx}]")
        if intent in seen_intents:
            raise BankLoadError(f"의도 중복 정의: {intent.value}")
        seen_intents.add(intent)
        _check_routing(intent, group)
        reviewed = group.get("reviewed")
        if not isinstance(reviewed, bool):
            raise BankLoadError(f"{intent.value}: reviewed는 bool이어야 함")
        origin = group.get("origin", default_origin)
        slot_pattern = _parse_slot_pattern(group.get("slot_pattern"), intent)
        questions = group.get("questions")
        if not isinstance(questions, Sequence) or isinstance(questions, (str, bytes)) or not questions:
            raise BankLoadError(f"{intent.value}: questions는 비어있지 않은 목록이어야 함")
        for q_idx, question in enumerate(questions):
            if not isinstance(question, str) or not question.strip():
                raise BankLoadError(f"{intent.value}[{q_idx}]: 질문이 비어있음")
            entry_id = f"{intent.value}#{q_idx:02d}"
            prev = seen_questions.get(question)
            if prev is not None:
                raise BankLoadError(f"질문 완전중복: {question!r} ({prev} vs {entry_id})")
            seen_questions[question] = entry_id
            entries.append(
                BankEntry(
                    entry_id=entry_id,
                    intent=intent,
                    question=question,
                    reviewed=reviewed,
                    origin=str(origin),
                    bank_version=version,
                    slot_pattern=slot_pattern,
                )
            )
    return tuple(entries)


def _parse_intent(label: object, where: str) -> Intent:
    try:
        intent = Intent(label)
    except ValueError:
        raise BankLoadError(f"{where}: closed-set 밖 의도 라벨 {label!r}") from None
    if intent not in ROUTABLE_INTENTS:
        raise BankLoadError(f"{where}: 위임 대상이 아닌 라벨은 뱅크에 실을 수 없음 {intent.value}")
    return intent


def _check_routing(intent: Intent, group: Mapping) -> None:
    """yaml의 handler·mode가 라우팅 테이블 정본과 어긋나면 즉시 드러낸다 (드리프트 방지)."""
    entry = route_for(intent)
    handler = group.get("handler")
    if handler is not None and not isinstance(handler, str):
        raise BankLoadError(f"{intent.value}: handler는 문자열 또는 null")
    if handler != entry.handler:
        raise BankLoadError(
            f"{intent.value}: handler가 라우팅 테이블과 불일치 "
            f"(yaml={handler!r}, 정본={entry.handler!r})"
        )
    raw_mode = group.get("mode")
    mode = _YAML_MODE.get(raw_mode) if isinstance(raw_mode, str) else None
    if mode is None:
        raise BankLoadError(f"{intent.value}: 알 수 없는 mode {raw_mode!r}")
    if mode is not entry.mode:
        raise BankLoadError(
            f"{intent.value}: mode가 라우팅 테이블과 불일치 "
            f"(yaml={mode.value}, 정본={entry.mode.value})"
        )


def _parse_slot_pattern(value: object, intent: Intent) -> dict:
    if value is None:
        return {}
    pattern = _require_mapping(value, f"{intent.value}.slot_pattern")
    for name, rule in pattern.items():
        if not isinstance(name, str) or not isinstance(rule, str):
            raise BankLoadError(f"{intent.value}.slot_pattern: 키·값 모두 문자열이어야 함")
    return dict(pattern)


def load_bank_file(path: Path, parse: Callable[[str], object]) -> tuple[BankEntry, ...]:
    """yaml 파일 → BankEntry 목록. `parse`는 yaml 디코더 주입 (모듈 docstring 참조)."""
    return load_bank(parse(path.read_text(encoding="utf-8")))


def index_bank(
    entries: Sequence[BankEntry],
    embedding: EmbeddingPort,
    store: VectorStorePort,
    *,
    collection: str = BANK_COLLECTION,
    allow_unreviewed: bool = False,
) -> int:
    """뱅크를 임베딩해 벡터 스토어에 적재하고 적재 건수를 반환한다.

    `allow_unreviewed=False`(기본)에서 미검수 항목을 만나면 UnreviewedBankError —
    한 건도 적재하지 않는다 (부분 적재로 인한 반쪽 뱅크 방지).
    """
    if not allow_unreviewed:
        pending = sorted({e.intent.value for e in entries if not e.reviewed})
        if pending:
            raise UnreviewedBankError(
                "검수 전(reviewed: false) 항목은 뱅크에 편입할 수 없음 "
                f"(ai/data/README.md) — 대상 의도: {', '.join(pending)}. "
                "평가·테스트 목적이면 allow_unreviewed=True로 명시할 것"
            )
    vectors = embedding.embed_batch([e.question for e in entries])
    if len(vectors) != len(entries):
        raise BankLoadError("임베딩 개수가 질문 수와 불일치")
    for entry, vector in zip(entries, vectors):
        if len(vector) != embedding.dim:  # BR-AF-09 — 차원 위반은 조용히 넘기지 않는다
            raise BankLoadError(f"{entry.entry_id}: 임베딩 차원 {len(vector)} != {embedding.dim}")
        store.upsert(collection, entry.entry_id, vector, entry.payload())
    return len(entries)
