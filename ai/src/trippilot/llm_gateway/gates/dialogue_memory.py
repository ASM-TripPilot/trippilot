"""DIALOGUE_MEMORY 출구 게이트 — 세션 기억 요약 줄 묶음 (assistant-orchestrator FD DE §2.6·§2.10, BR-AO-09).

산출물은 `tuple[str, ...]` 다. 다음 턴의 분류·답변 프롬프트에 `$memory` 로 되돌아가고, 내보내기 경계
(`GET /ai/v1/dialogue/memory`)로 사용자에게도 보인다. poi 선택이 없어 후보 풀과 무관하고, 스키마 +
줄 단위 안전성만 강제한다 (paraphrase 게이트와 같은 형).

항목 격리(paraphrase·place_extraction 선례) — 한 줄이 나쁘다고 요약 전체를 버리지 않는다. 남은 줄로도
기억은 성립한다.

정리 — 위반 줄은 **그 줄만** 드롭(GateDropEvent 로 계측):
  ① 문자열 아님·공백뿐
  ② 길이 > `_MAX_LINE_CHARS` — 자르지 않는다. 잘린 사실은 다른 사실이 된다
  ③ 시간 표현(`reflection_template._TIME_EXPR`) — 소요시간은 INV-3, 시각은 스냅샷만 말한다(INV-2).
     다음 턴 프롬프트에 되돌아가는 값이라 여기서 끊어야 전파가 멎는다
  ④ 링크·연락처 꼴(`has_contact_like`) — 최근 턴에 실린 제3자 문자열이 요약으로 굳는 것을 막는다
  ④′ 지시 주입·프롬프트 골격 꼴(`has_injection_like`) — 기억은 다음 턴마다 `$memory` 로 되돌아가 한 번 굳으면 매 턴 다시 주입된다
  ⑤ 중복(첫 등장 유지)
  ⑥ 개수 상한 `_MAX_LINES` — 초과분도 드롭으로 계측
  ⑦ 종류 표지 — "종류: 내용" 꼴이고 종류가 닫힌 6종(`MEMORY_KINDS`) 안이어야 한다. 통과 줄은 "종류: 내용" 한 꼴로 맞춘다
     (2026-10-23 — "요약" 줄은 늘 싣고 나머지는 관련된 것만 꺼내므로 종류가 곧 쓰임새다)
  ⑧ "요약" 줄은 `_MAX_GIST_LINES` 까지 — 늘 실리는 줄이라 길어지면 매 턴 토큰이 는다
**전부 드롭 = 실패, 비운 배열 = 성공·0건** (TRIP-260 #5 의 추출 계열 쪽, 2026-10-19 개정): 게이트가 줄을 다 버렸으면
오케스트레이터는 이전 기억을 그대로 두고 다음 턴에 다시 요약한다(INV-4 — 2026-10-23 부터 결정론 압축은 없다). LLM 이 비운
배열은 "새로 기억할 것 없음"이라는 프롬프트 규칙의 답이라 실패가 아니다 — 처음엔 실패로 봐 압축이 대화 원문 조각을
저장했다(배포 스모크 3/3). 0줄 성공은 오케스트레이터가 `dialogue_memory_empty` 건수 로그로 센다.

"error 있으면 value 비움" 불변식은 base.GateOutcome 이 강제한다.
"""

from __future__ import annotations

import re
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.observability import GateDropEvent
from trippilot.llm_gateway.gates.base import (
    GateOutcome,
    _load_json_object,
    empty_result_error,
    has_contact_like,
    has_injection_like,
)
from trippilot.llm_gateway.gates.reflection_template import _TIME_EXPR
from trippilot.ports.memory_store_port import GIST_KIND, split_kind

# 요약 상한 (FD DE §2.6 — ≤20줄 · 줄 ≤120자). 프롬프트의 "최대 20줄"·"120자 이내"와 같은 값(테스트가 고정).
# ponytail: 오케스트레이터 config(summary_max_lines·summary_line_chars)와 같은 값을 따로 둔다 —
# 게이트는 raw_text 만 받아 설정을 모른다(paraphrase 선례). 갈라지면 공유 상수로 승격.
_MAX_LINES = 20
_MAX_LINE_CHARS = 120
_MAX_GIST_LINES = 2  # 프롬프트 "요약 … 최대 2줄"과 같은 값
_BULLET = re.compile(r"^\s*[-*•·]\s+")


class DialogueMemoryGate:
    """DIALOGUE_MEMORY 출구 게이트 — {"lines": ["종류: 내용"]} → tuple[str, ...]."""

    def apply(
        self,
        raw_text: str,
        pool: CandidatePool | None,
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        try:
            items = _load_json_object(raw_text, "lines")
            if not isinstance(items, list):
                raise ValueError("lines가 배열이 아님")
        except ValueError as e:
            return GateOutcome(value=(), drop_event=None, error=f"parse_error: {e}")

        survivors: list[str] = []
        dropped_count = gists = 0
        for item in items:
            # 앞의 목록 기호는 뗀다 — [이전 요약]이 "- 선호: …" 꼴로 렌더돼 모델이 그 꼴째 옮기면 표지가 안 읽혀 줄을 다 버렸다(리뷰 재현)
            raw = _BULLET.sub("", item).strip() if isinstance(item, str) else ""
            kind, body = split_kind(raw)
            line = f"{kind}: {body}"
            if (
                not raw  # ①
                or kind is None  # ⑦
                or len(line) > _MAX_LINE_CHARS  # ②
                or _TIME_EXPR.search(line) is not None  # ③ (INV-3·INV-2)
                or has_contact_like(line)  # ④
                or has_injection_like(line)  # ④′
                or line in survivors  # ⑤
                or len(survivors) >= _MAX_LINES  # ⑥
                or (kind == GIST_KIND and gists >= _MAX_GIST_LINES)  # ⑧
            ):
                dropped_count += 1
                continue
            gists += kind == GIST_KIND
            survivors.append(line)

        drop_event = (
            GateDropEvent(
                trace_id=trace_id,
                occurred_at=now,
                component="c1.gate",
                feature=feature.value,
                dropped_ids=(),  # 줄 드롭은 풀 ID가 아님 — 환각률 지표 순수성 (paraphrase 선례)
                total_count=len(items),
                dropped_count=dropped_count,
            )
            if dropped_count
            else None
        )
        # LLM 이 비운 배열은 "새로 기억할 것 없음"이라는 정상 결과다(프롬프트 규칙의 답) — 행사 추출처럼 성공·0건.
        # 실패로 보면 결정론 압축이 대화 원문 조각을 저장한다(2026-10-19 배포 스모크 3/3). 다 버려서 빈 것은 실패다.
        return GateOutcome(
            value=tuple(survivors),
            drop_event=drop_event,
            error=empty_result_error(survivors, drop_event) if items else None,
        )
