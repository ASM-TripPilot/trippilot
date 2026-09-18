# 리마인드 알림 카피 — 파인튜닝 로컬 LLM 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여행 리마인드 알림 문구(당일 아침·D-1)를 하드코딩 상수에서 일정 내용을 반영한 생성 문구로 바꾼다 — 생성은 파인튜닝한 로컬 LLM이 맡고, 실패하면 백엔드 상수로 결정론 폴백한다.

**Architecture:** 새 `LlmFeature.REMINDER_COPY` 하나와 경계 `POST /ai/v1/notification/copies` 하나. 에이전트를 만들지 않고 **경계→워커 직행**이다(u6-reflect FD §2.1 — 판단 없는 단발 변환). 워커는 예약 항목마다 LLM을 1회씩 부르고, 결정론 게이트를 통과한 항목만 응답에 싣는다. 모델 배정은 `TRIPPILOT_LLM_FEATURE_MODELS` 로 `local-*` 접두어를 주고, `RoutingLlm` 이 접두어를 보고 로컬 OpenAI 호환 서버로 보낸다 — 어댑터 신규 구현은 0이다.

**Tech Stack:** Python 3.11 · FastAPI · pydantic(BoundaryModel) · pytest + Hypothesis · OpenAI 호환 로컬 서빙(vLLM/MLX) · MLX LoRA(학습) · Modal 서버리스(서빙)

**Spec:** `ai/docs/superpowers/specs/2026-09-08-reminder-copy-local-llm-design.md`

## Global Constraints

- **INV-1** 문구가 언급하는 장소는 그날 슬롯 안에서만. 게이트가 강제한다.
- **INV-2** 문구는 시각·순서를 주장하지 않는다(시간 토큰 자체를 게이트가 드롭).
- **INV-3** 소요시간 표시 금지 — 금지 토큰 `("분", "시간", "시각", "duration")` 포함 시 드롭. 와이어 필드명에도 `duration` 토큰 금지.
- **INV-4** 폴백은 백엔드 상수. AI 실패로 알림이 안 나가는 침묵 실패 금지 — 강등은 이벤트로 계측된다.
- **CI 실호출 0** — ai-ci 는 모든 외부 API를 fake 한다. 실 LLM 스모크는 cron·수동 워크플로 전용.
- **모델 문자열 하드코딩 금지** (BR-U4-08) — 항상 설정값 주입.
- **`ai/docs/openapi.json` 손편집 금지** — `python scripts/export_openapi.py` 로 재생성.
- **새 코드에 `c1`·`c2`·`m7` 용어 금지** (팀 방침 2026-09-12) — 역할 이름을 쓴다. 기존 심볼명(`C1Config` 등)은 그대로 사용하되 새 이름을 만들지 않는다.
- **커밋·PR에 Claude 흔적 금지** — Co-Authored-By·세션 링크 넣지 않는다.
- **커밋 메시지에 Jira 키 금지** (자동화 오닫힘 방지) — 키는 파일 본문에만. 백엔드 티켓 = TRIP-836.
- 작업 브랜치는 `develop` 에서 분기: `feature/reminder-copy-local-llm` (AI 트랙 티켓 발급 시 키를 붙여 rename).

## 착수 전 1회

- [ ] `/wiki-sync ai/tests` — 2026-09-12 기준 이 영역 노트가 10건 밀려 "착수 전 갱신 권고" 에 걸려 있다(테스트 관례를 낡은 배경으로 읽으면 안 된다).
- [ ] `bash ~/dev/llm-wiki/scripts/wiki_check.sh ai/src/trippilot/llm_gateway` 실행 — 권고가 나오면 그 경로도 먼저 갱신한다.
- [ ] `git fetch origin develop && git switch -c feature/reminder-copy-local-llm origin/develop` (메인 작업트리는 다른 세션이 공유 중 — 별도 worktree 권장).

## File Structure

| 파일 | 책임 |
|---|---|
| `ai/src/trippilot/domain/llm.py` (수정) | `LlmFeature.REMINDER_COPY` 추가 |
| `ai/src/trippilot/llm_gateway/config.py` (수정) | 티어 LIGHT 매핑 · 폴백 모드 쌍 |
| `ai/src/trippilot/llm_gateway/gates/reminder_copy.py` (신규) | 게이트 컨텍스트 + 출구 게이트 (길이·금지토큰·장소 대조) |
| `ai/prompts/reminder_copy.yaml` (신규) | 프롬프트 템플릿 |
| `ai/src/trippilot/llm_gateway/workers/reminder_copy.py` (신규) | 항목별 호출 루프 · 마감 배분 · 입출력 타입 |
| `ai/src/trippilot/api/schemas.py` (수정) | 요청·응답 경계 스키마 |
| `ai/src/trippilot/api/routes.py` (수정) | `notification_router` + `POST /copies` |
| `ai/src/trippilot/api/app.py` (수정) | 라우터 등록 |
| `ai/src/trippilot/api/wiring.py` (수정) | 핸들러 + 조립(워커 생성) |
| `ai/main.py` (수정) | `local` 라우트 · 미설정 기동 실패 |
| `docker-compose.yml` · `.env.example` (수정) | env 2겹 통로 |
| `ai/scripts/finetune_reminder/` (신규) | 데이터 생성·필터·평가·런북 (CI 밖) |

---

### Task 1: feature 등록과 설정 매핑

**Files:**
- Modify: `ai/src/trippilot/domain/llm.py` (`class LlmFeature`)
- Modify: `ai/src/trippilot/llm_gateway/config.py` (`default_tier_map`, `default_fallback_modes`)
- Test: `ai/tests/test_llm_gateway_gateway.py` (기존 전 feature 스윕이 자동으로 새 값을 검사한다)

**Interfaces:**
- Consumes: 없음 (첫 작업)
- Produces: `LlmFeature.REMINDER_COPY` — 이후 모든 작업이 이 심볼을 쓴다.

- [ ] **Step 1: 스윕 테스트를 먼저 돌려 현재 초록임을 확인**

Run: `cd ai && uv run pytest tests/test_llm_gateway_gateway.py -q`
Expected: PASS (기준선)

- [ ] **Step 2: enum 에 feature 추가**

`ai/src/trippilot/domain/llm.py` 의 `class LlmFeature` 안, `REFLECTION_NUDGE` 줄 **아래**에 추가:

```python
    # 여행 리마인드 알림 문구(당일 아침·D-1) — 회고 유도 문구(REFLECTION_NUDGE)와 별개 기능.
    # 별도 feature 인 이유: 파인튜닝 로컬 모델 배정을 feature 단위로만 가를 수 있다.
    # 알림 발송·폴백 사용은 백엔드 notification 소유 — 여기는 문구 생성까지만.
    REMINDER_COPY = "REMINDER_COPY"  # U6 (설계: specs/2026-09-08-reminder-copy-local-llm-design.md)
```

- [ ] **Step 3: 티어 매핑 추가**

`ai/src/trippilot/llm_gateway/config.py` 의 `default_tier_map()` 반환 dict 에서 `LlmFeature.REFLECTION_NUDGE` 줄 아래에 추가:

```python
            # 알림 문구 2줄 — 넛지와 동급 과업이라 LIGHT. 실제로는 feature_models
            # 오버라이드로 로컬 파인튜닝 모델이 배정된다(티어 해석보다 우선).
            LlmFeature.REMINDER_COPY: ModelTier.LIGHT,
```

- [ ] **Step 4: 폴백 모드 쌍 추가**

같은 파일 `default_fallback_modes()` 반환 dict 에서 `LlmFeature.REFLECTION_NUDGE` 줄 아래에 추가:

```python
            # api/wiring.py `reminder_copy` — 문구를 못 만들면 그 항목을 응답에서 빼고,
            # 백엔드가 기존 하드코딩 상수(NotificationSchedule.title()/body())로 보낸다.
            # to_mode 가 "backend_constant" 인 이유: 폴백 실행 주체가 백엔드다.
            LlmFeature.REMINDER_COPY: ("llm_reminder_copy", "backend_constant"),
```

- [ ] **Step 5: 스윕 테스트 재실행**

Run: `cd ai && uv run pytest tests/test_llm_gateway_gateway.py tests/test_reflect_composer_vision.py -q`
Expected: PASS — 새 feature 가 매핑에 있으므로 `UNMAPPED_FALLBACK_MODES` 로 새지 않는다.

- [ ] **Step 6: 커밋**

```bash
git add ai/src/trippilot/domain/llm.py ai/src/trippilot/llm_gateway/config.py
git commit -m "feat(ai): LlmFeature.REMINDER_COPY 등록 — 티어·폴백 모드 매핑"
```

---

### Task 2: 출구 게이트

문구가 거짓말을 못 하게 막는 자리다. **모델이 언급한 장소를 스스로 선언하게 하고**(`places`), 게이트가 그 선언을 그날 슬롯과 대조한다 — 자유 한국어 본문에서 장소를 추출하는 문제를 풀지 않으려는 선택이다(edit_translation 의 `affectedSlots`, photo_highlight 의 photo_id 튜플과 같은 형).

**Files:**
- Create: `ai/src/trippilot/llm_gateway/gates/reminder_copy.py`
- Test: `ai/tests/test_llm_gateway_reminder_copy.py`

**Interfaces:**
- Consumes: `LlmFeature.REMINDER_COPY` (Task 1)
- Produces:
  - `ReminderCopyContext(allowed: tuple[str, ...], forbidden: tuple[str, ...])` — `GatewayFacade.call` 의 `pool` 자리로 관통
  - `ReminderCopyGate.apply(...) -> GateOutcome` — 성공 시 `value = ReminderCopyDraft(title: str, body: str)`
  - `ReminderCopyDraft(title: str, body: str)`
  - 상수 `_MAX_TITLE = 20` · `_MAX_BODY = 60` · `_FORBIDDEN_TOKENS`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `ai/tests/test_llm_gateway_reminder_copy.py`:

```python
"""REMINDER_COPY 게이트 — 길이·금지 토큰·장소 대조 (INV-1·INV-3).

증명하는 것:
  ① 통과한 문구는 title ≤20자 · body ≤60자 · 금지 토큰 없음
  ② 선언한 장소가 그날 슬롯 밖이면 드롭 (INV-1)
  ③ 선언하지 않은 다른 날 장소가 본문에 있으면 드롭 (선언 회피 차단)
  ④ 파싱 실패는 조용히 넘기지 않고 error 로 수렴 (INV-4)
  ⑤ PBT — 임의 문자열 입력에 예외 0, 통과분은 항상 규칙 전부 만족
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.llm_gateway.gates.reminder_copy import (
    _FORBIDDEN_TOKENS,
    _MAX_BODY,
    _MAX_TITLE,
    ReminderCopyContext,
    ReminderCopyGate,
)

NOW = datetime(2026, 9, 12, 9, 0, tzinfo=timezone.utc)
TRACE = TraceId("t-1")
CTX = ReminderCopyContext(
    allowed=("성산일출봉", "우도"), forbidden=("한라산", "협재해수욕장")
)


def _apply(payload: dict, ctx: ReminderCopyContext = CTX):
    return ReminderCopyGate().apply(
        json.dumps(payload, ensure_ascii=False),
        ctx,
        feature=LlmFeature.REMINDER_COPY,
        trace_id=TRACE,
        now=NOW,
    )


def test_valid_copy_passes() -> None:
    out = _apply({"title": "오늘의 제주", "body": "성산일출봉에서 시작하는 하루예요", "places": ["성산일출봉"]})
    assert out.error is None
    assert out.value.title == "오늘의 제주"
    assert out.value.body == "성산일출봉에서 시작하는 하루예요"


def test_place_outside_day_slots_dropped() -> None:
    out = _apply({"title": "오늘의 제주", "body": "한라산에 오르는 날이에요", "places": ["한라산"]})
    assert out.value is None
    assert out.drop_event is not None


def test_undeclared_other_day_place_in_body_dropped() -> None:
    out = _apply({"title": "오늘의 제주", "body": "협재해수욕장도 좋아요", "places": []})
    assert out.value is None
    assert out.drop_event is not None


def test_declared_place_absent_from_body_dropped() -> None:
    out = _apply({"title": "오늘의 제주", "body": "느긋하게 걸어볼까요", "places": ["우도"]})
    assert out.value is None
    assert out.drop_event is not None


def test_forbidden_token_dropped() -> None:
    out = _apply({"title": "오늘의 제주", "body": "30분이면 도착해요", "places": []})
    assert out.value is None
    assert out.drop_event is not None


def test_too_long_body_dropped() -> None:
    out = _apply({"title": "오늘의 제주", "body": "가" * (_MAX_BODY + 1), "places": []})
    assert out.value is None
    assert out.drop_event is not None


def test_malformed_json_is_error_not_silent() -> None:
    out = ReminderCopyGate().apply(
        "not json", CTX, feature=LlmFeature.REMINDER_COPY, trace_id=TRACE, now=NOW
    )
    assert out.value is None
    assert out.error is not None and out.error.startswith("parse_error")


def test_missing_context_is_error() -> None:
    out = ReminderCopyGate().apply(
        json.dumps({"title": "t", "body": "b", "places": []}),
        None,
        feature=LlmFeature.REMINDER_COPY,
        trace_id=TRACE,
        now=NOW,
    )
    assert out.value is None
    assert out.error is not None


@settings(max_examples=200, deadline=None)
@given(st.text(max_size=200), st.text(max_size=200), st.lists(st.text(max_size=20), max_size=5))
def test_pbt_pass_implies_all_rules(title: str, body: str, places: list[str]) -> None:
    out = _apply({"title": title, "body": body, "places": places})
    if out.value is None:
        return
    assert 0 < len(out.value.title) <= _MAX_TITLE
    assert 0 < len(out.value.body) <= _MAX_BODY
    lowered = out.value.body.lower() + out.value.title.lower()
    assert not any(t in lowered for t in _FORBIDDEN_TOKENS)
    for name in places:
        if name.strip():
            assert name.strip() in CTX.allowed


@settings(max_examples=200, deadline=None)
@given(st.text(max_size=300))
def test_pbt_arbitrary_text_never_raises(raw: str) -> None:
    ReminderCopyGate().apply(
        raw, CTX, feature=LlmFeature.REMINDER_COPY, trace_id=TRACE, now=NOW
    )
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd ai && uv run pytest tests/test_llm_gateway_reminder_copy.py -q`
Expected: FAIL — `ModuleNotFoundError: trippilot.llm_gateway.gates.reminder_copy`

- [ ] **Step 3: 게이트를 구현한다**

Create `ai/src/trippilot/llm_gateway/gates/reminder_copy.py`:

```python
"""REMINDER_COPY 출구 게이트 — 리마인드 알림 문구 1건(title/body).

산출물은 사용자에게 보이는 **알림 문구**다. 표시 안전성(길이·금지 토큰)에 더해
**장소 대조**를 한다 — 문구가 그날 일정에 없는 곳을 말하면 사용자는 일정이 바뀐
줄 안다(INV-1 정신). 자유 한국어에서 장소를 추출하는 문제는 풀지 않는다: 모델이
언급한 장소를 `places` 로 **스스로 선언**하게 하고 그 선언을 대조한다
(edit_translation 의 affectedSlots 선례).

선언 회피를 막는 대칭 규칙이 하나 더 있다 — 같은 여행의 **다른 날 장소**가 본문에
있으면 선언 여부와 무관하게 드롭한다. 가장 흔한 실패(다른 날 일정을 오늘로 말하기)를
값싸게 잡는다. 세상의 모든 지명을 막지는 못하지만, 못 막는 몫은 폴백이 받는다.

위반은 전부 **드롭**(GateDropEvent) — 빈 결과는 실패이고, 알림 자체는 백엔드가
기존 상수로 보낸다(INV-4, 침묵 실패 금지).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.domain.observability import GateDropEvent
from trippilot.llm_gateway.gates.base import (
    GateOutcome,
    empty_result_error,
    strip_code_fence,
)

# 푸시 제목·본문 상한 (프롬프트의 "20자/60자"와 같은 값 — 테스트가 고정한다)
_MAX_TITLE = 20
_MAX_BODY = 60

# 소요시간·시각 계열 표시 금지 (INV-3). 부분 문자열 매칭 — 과잉 드롭은 폴백으로 안전.
_FORBIDDEN_TOKENS = ("분", "시간", "시각", "duration")


@dataclass(frozen=True, slots=True)
class ReminderCopyContext:
    """게이트 검증 컨텍스트 — `GatewayFacade.call` 의 pool 자리로 관통.

    allowed: 그날 일정의 장소명. 문구가 말해도 되는 전부.
    forbidden: 같은 여행의 **다른 날** 장소명. 본문에 나오면 드롭한다.
    """

    allowed: tuple[str, ...]
    forbidden: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ReminderCopyDraft:
    title: str
    body: str


class ReminderCopyGate:
    """REMINDER_COPY 출구 게이트 — {"title", "body", "places"} → ReminderCopyDraft."""

    def apply(
        self,
        raw_text: str,
        pool: object,  # ReminderCopyContext — pool 자리로 관통 (ExitGate 계약 호환)
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        if not isinstance(pool, ReminderCopyContext):
            return GateOutcome(
                value=None,
                drop_event=None,
                error="gate_error: ReminderCopyContext 없음 (그날 슬롯 대조 집합 필요)",
            )
        ctx = pool
        try:
            data = json.loads(strip_code_fence(raw_text))
            if not isinstance(data, dict):
                raise ValueError("최상위가 객체가 아님")
            title = data["title"]
            body = data["body"]
            places = data.get("places", [])
            if not isinstance(title, str) or not isinstance(body, str):
                raise ValueError("title·body 가 문자열이 아님")
            if not isinstance(places, list) or any(not isinstance(p, str) for p in places):
                raise ValueError("places 가 문자열 배열이 아님")
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")

        title = title.strip()
        body = body.strip()
        declared = tuple(p.strip() for p in places if p.strip())
        allowed = set(ctx.allowed)
        lowered = (title + body).lower()

        dropped = (
            not title
            or not body
            or len(title) > _MAX_TITLE
            or len(body) > _MAX_BODY
            or any(t in lowered for t in _FORBIDDEN_TOKENS)  # INV-3
            or any(name not in allowed for name in declared)  # INV-1
            or any(name not in body for name in declared)  # 선언 정직성
            or any(name and name in body for name in ctx.forbidden)  # 선언 회피 차단
        )
        if dropped:
            drop_event = GateDropEvent(
                trace_id=trace_id,
                occurred_at=now,
                component="c1.gate",
                feature=feature.value,
                dropped_ids=(),  # 문구 드롭은 풀 ID가 아님 (nudge·paraphrase 선례)
                total_count=1,
                dropped_count=1,
            )
            return GateOutcome(
                value=None,
                drop_event=drop_event,
                error=empty_result_error(None, drop_event),
            )
        return GateOutcome(
            value=ReminderCopyDraft(title=title, body=body), drop_event=None, error=None
        )
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd ai && uv run pytest tests/test_llm_gateway_reminder_copy.py -q`
Expected: PASS (PBT 2건 포함)

- [ ] **Step 5: 커밋**

```bash
git add ai/src/trippilot/llm_gateway/gates/reminder_copy.py ai/tests/test_llm_gateway_reminder_copy.py
git commit -m "feat(ai): REMINDER_COPY 출구 게이트 — 길이·금지 토큰·장소 대조 + PBT"
```

---

### Task 3: 프롬프트와 워커

**Files:**
- Create: `ai/prompts/reminder_copy.yaml`
- Create: `ai/src/trippilot/llm_gateway/workers/reminder_copy.py`
- Test: `ai/tests/test_llm_gateway_reminder_copy_worker.py`

**Interfaces:**
- Consumes: `ReminderCopyContext`·`ReminderCopyDraft` (Task 2), `LlmFeature.REMINDER_COPY` (Task 1)
- Produces:
  - `ReminderCopyItem(schedule_key: str, kind: str, date_label: str, slot_names: tuple[str, ...])`
  - `ReminderCopyInput(trip_title: str, items: tuple[ReminderCopyItem, ...])`
  - `ReminderCopyResult(schedule_key: str, title: str, body: str)`
  - `ReminderCopyWorker.generate(inp, trace_id, now, *, budget_sec: float | None) -> tuple[tuple[ReminderCopyResult, ...], int]` — (성공분, 드롭 건수)
  - `MIN_CALL_SEC = 0.5`

- [ ] **Step 1: 프롬프트 파일을 만든다**

Create `ai/prompts/reminder_copy.yaml`:

```yaml
# ReminderCopy 프롬프트 v0.1.0 — 정본: specs/2026-09-08-reminder-copy-local-llm-design.md
# 파인튜닝 학생 모델(local-*)이 이 형식을 그대로 배운다 — 학습 데이터 생성도 같은 템플릿을 쓴다.
feature: REMINDER_COPY
version: "0.1.0"
template: |
  당신은 여행 일정 알림 문구를 쓰는 어시스턴트입니다.
  아래 하루 일정을 보고 사용자에게 보낼 알림의 제목과 본문을 작성하세요.

  규칙:
  - 제목은 20자 이내, 본문은 정확히 1문장 20자 이상 60자 이내로 작성하세요
  - 소요시간·이동시간·시각을 언급하지 마세요
  - 아래 [오늘 일정]에 있는 장소만 언급하세요. 다른 장소는 절대 쓰지 마세요
  - 본문에서 언급한 장소를 places 배열에 그대로 적으세요. 언급하지 않았으면 빈 배열입니다
  - 과장하거나 단정하지 마세요, 이모지는 0~1개만 사용하세요
  - 아래 JSON 스키마를 정확히 따르고, JSON 외의 텍스트는 출력하지 마세요

  [알림 종류] $kind_label
  [여행] $trip_title
  [날짜] $date_label
  [오늘 일정] $slot_names

  [출력 JSON 스키마]
  {"title": "string(20자 이내)", "body": "string(1문장, 60자 이내)", "places": ["string"]}
```

- [ ] **Step 2: 실패하는 워커 테스트를 쓴다**

Create `ai/tests/test_llm_gateway_reminder_copy_worker.py`:

```python
"""REMINDER_COPY 워커 — 항목별 호출·마감 배분·부분 성공 (INV-4).

증명하는 것:
  ① 항목마다 1회씩 부르고, 게이트 통과분만 결과에 담는다 (부분 성공 = 정상)
  ② 폴백·드롭 항목은 결과에서 빠지고 드롭 건수로 보고된다 — 침묵 금지
  ③ 예산이 있으면 게이트웨이 호출에 **관통**한다 (기본 타임아웃에 얹히지 않는다)
  ④ 예산이 바닥나면 남은 항목을 부르지 않고 드롭으로 보고한다
  ⑤ 다른 날 장소가 그 항목의 forbidden 으로 들어간다
"""

from __future__ import annotations

from datetime import datetime, timezone

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.llm_gateway.gates.reminder_copy import ReminderCopyContext, ReminderCopyDraft
from trippilot.llm_gateway.workers.reminder_copy import (
    ReminderCopyInput,
    ReminderCopyItem,
    ReminderCopyWorker,
)

NOW = datetime(2026, 9, 12, 9, 0, tzinfo=timezone.utc)
TRACE = TraceId("t-1")

ITEMS = (
    ReminderCopyItem(
        schedule_key="k1", kind="TRIP_DAY", date_label="2026-09-13",
        slot_names=("성산일출봉", "우도"),
    ),
    ReminderCopyItem(
        schedule_key="k2", kind="TRIP_DAY", date_label="2026-09-14",
        slot_names=("한라산",),
    ),
)


class FakeGateway:
    """호출을 기록하고 지정한 결과를 순서대로 돌려주는 대역."""

    def __init__(self, results: list[TypedResult]) -> None:
        self.results = list(results)
        self.calls: list[dict] = []

    def call(self, feature, prompt_vars, pool, trace_id, now, *, timeout_sec=None, **kw):
        self.calls.append(
            {"feature": feature, "vars": dict(prompt_vars), "pool": pool, "timeout_sec": timeout_sec}
        )
        return self.results.pop(0)


def _ok(title: str, body: str) -> TypedResult:
    return TypedResult(value=ReminderCopyDraft(title, body), is_fallback=False, error=None, call_record=None)


def _fallback() -> TypedResult:
    return TypedResult(value=None, is_fallback=True, error="gate_dropped_all", call_record=None)


def test_calls_once_per_item_and_collects_successes() -> None:
    gw = FakeGateway([_ok("제목1", "본문1"), _ok("제목2", "본문2")])
    copies, dropped = ReminderCopyWorker(gw).generate(
        ReminderCopyInput(trip_title="제주 3일", items=ITEMS), TRACE, NOW, budget_sec=None
    )
    assert len(gw.calls) == 2
    assert [c.schedule_key for c in copies] == ["k1", "k2"]
    assert dropped == 0
    assert all(c["feature"] is LlmFeature.REMINDER_COPY for c in gw.calls)


def test_partial_failure_is_reported_not_silent() -> None:
    gw = FakeGateway([_ok("제목1", "본문1"), _fallback()])
    copies, dropped = ReminderCopyWorker(gw).generate(
        ReminderCopyInput(trip_title="제주 3일", items=ITEMS), TRACE, NOW, budget_sec=None
    )
    assert [c.schedule_key for c in copies] == ["k1"]
    assert dropped == 1


def test_budget_is_passed_through_to_gateway() -> None:
    gw = FakeGateway([_ok("제목1", "본문1"), _ok("제목2", "본문2")])
    ReminderCopyWorker(gw).generate(
        ReminderCopyInput(trip_title="제주 3일", items=ITEMS), TRACE, NOW, budget_sec=8.0
    )
    assert all(c["timeout_sec"] is not None and c["timeout_sec"] > 0 for c in gw.calls)


def test_exhausted_budget_skips_remaining_items() -> None:
    gw = FakeGateway([_ok("제목1", "본문1")])
    copies, dropped = ReminderCopyWorker(gw).generate(
        ReminderCopyInput(trip_title="제주 3일", items=ITEMS), TRACE, NOW, budget_sec=0.4
    )
    # 예산이 최소 호출 시간보다 작으면 한 건도 부르지 않고 전부 드롭으로 보고한다
    assert copies == () and dropped == 2 and gw.calls == []


def test_other_day_places_become_forbidden() -> None:
    gw = FakeGateway([_ok("제목1", "본문1"), _ok("제목2", "본문2")])
    ReminderCopyWorker(gw).generate(
        ReminderCopyInput(trip_title="제주 3일", items=ITEMS), TRACE, NOW, budget_sec=None
    )
    ctx = gw.calls[0]["pool"]
    assert isinstance(ctx, ReminderCopyContext)
    assert ctx.allowed == ("성산일출봉", "우도")
    assert "한라산" in ctx.forbidden
```

- [ ] **Step 3: 실패를 확인한다**

Run: `cd ai && uv run pytest tests/test_llm_gateway_reminder_copy_worker.py -q`
Expected: FAIL — `ModuleNotFoundError: trippilot.llm_gateway.workers.reminder_copy`

- [ ] **Step 4: 워커를 구현한다**

Create `ai/src/trippilot/llm_gateway/workers/reminder_copy.py`:

```python
"""ReminderCopyWorker — 리마인드 알림 문구 생성, 경량 티어.

**항목마다 한 번씩 부른다.** 한 요청에 하루치 여러 건이 오지만 배치 JSON 한 방으로
받지 않는다 — 작은 파인튜닝 모델은 단건 생성이 훨씬 안정적이고, 한 건이 망가져도
나머지가 산다(부분 성공이 이 기능의 정상 동작이다). 로컬 서빙이라 호출 수는 비용이
아니다.

실패·드롭 항목은 결과에서 **빠진다**. 그 자리는 백엔드가 기존 하드코딩 상수로
채운다(INV-4) — 그래서 이 워커에는 폴백 문구 상수가 없다. 빠진 건수는 호출측이
`degraded` 로 노출한다(침묵 금지).

예산은 게이트웨이 기본 타임아웃에 얹히지 않고 **관통**한다(TRIP-376 선례). 남은
예산을 남은 항목 수로 나눠 항목마다 배분하고, 최소 호출 시간(`MIN_CALL_SEC`)도 못
주는 상황이면 부르지 않고 드롭으로 보고한다 — 어차피 타임아웃할 호출을 하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.llm_gateway.gates.reminder_copy import ReminderCopyContext, ReminderCopyDraft

# 이보다 적은 예산으로는 호출하지 않는다 — 확정 타임아웃을 지불할 이유가 없다.
MIN_CALL_SEC = 0.5

_KIND_LABELS = {
    "TRIP_DAY": "여행 당일 아침 알림",
    "TRIP_PRE": "여행 하루 전 알림",
}


@dataclass(frozen=True, slots=True)
class ReminderCopyItem:
    """예약 1건 = 문구 1건. slot_names 순서는 호출측(백엔드)이 확정한 방문 순서."""

    schedule_key: str
    kind: str  # "TRIP_DAY" | "TRIP_PRE"
    date_label: str  # 표시용 날짜 문자열 (시각 아님 — INV-3)
    slot_names: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ReminderCopyInput:
    trip_title: str
    items: tuple[ReminderCopyItem, ...]


@dataclass(frozen=True, slots=True)
class ReminderCopyResult:
    schedule_key: str
    title: str
    body: str


def build_reminder_copy_vars(item: ReminderCopyItem, trip_title: str) -> dict[str, str]:
    """값 전부 str·결정론 — 좌표·시각 미포함."""
    return {
        "kind_label": _KIND_LABELS.get(item.kind, "여행 알림"),
        "trip_title": trip_title.strip() or "이번 여행",
        "date_label": item.date_label,
        "slot_names": " / ".join(item.slot_names) or "(일정 없음)",
    }


class ReminderCopyWorker:
    def __init__(self, gateway) -> None:
        self._gateway = gateway

    def generate(
        self,
        inp: ReminderCopyInput,
        trace_id: TraceId,
        now: datetime,
        *,
        budget_sec: float | None,
    ) -> tuple[tuple[ReminderCopyResult, ...], int]:
        copies: list[ReminderCopyResult] = []
        dropped = 0
        remaining = budget_sec
        total = len(inp.items)
        for index, item in enumerate(inp.items):
            left = total - index
            per_item = None if remaining is None else remaining / left
            if per_item is not None and per_item < MIN_CALL_SEC:
                dropped += left  # 남은 전부를 드롭으로 보고하고 끝낸다
                break
            result = self._gateway.call(
                LlmFeature.REMINDER_COPY,
                build_reminder_copy_vars(item, inp.trip_title),
                self._context(inp.items, index),
                trace_id,
                now,
                timeout_sec=per_item,
            )
            if remaining is not None and per_item is not None:
                remaining -= per_item
            draft = result.value
            if result.is_fallback or not isinstance(draft, ReminderCopyDraft):
                dropped += 1
                continue
            copies.append(
                ReminderCopyResult(
                    schedule_key=item.schedule_key, title=draft.title, body=draft.body
                )
            )
        return tuple(copies), dropped

    @staticmethod
    def _context(items: tuple[ReminderCopyItem, ...], index: int) -> ReminderCopyContext:
        """그날 장소 = allowed, 같은 여행의 다른 날 장소 = forbidden (중복은 allowed 우선)."""
        allowed = items[index].slot_names
        allowed_set = set(allowed)
        forbidden = tuple(
            dict.fromkeys(
                name
                for other_index, other in enumerate(items)
                if other_index != index
                for name in other.slot_names
                if name not in allowed_set
            )
        )
        return ReminderCopyContext(allowed=allowed, forbidden=forbidden)
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd ai && uv run pytest tests/test_llm_gateway_reminder_copy_worker.py -q`
Expected: PASS

- [ ] **Step 6: 프롬프트가 실제로 렌더되는지 확인한다**

`PromptRegistry` 는 `ai/prompts/` 를 통째로 스캔해 등록하고, 템플릿의 `$변수` 가
하나라도 안 채워지면 `ValueError("템플릿 변수 누락")` 을 낸다. 워커가 주는 4개 변수와
yaml 의 `$` 변수가 어긋나지 않는지 직접 확인한다:

```bash
cd ai && uv run python -c "
from pathlib import Path
from trippilot.domain.llm import LlmFeature
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.reminder_copy import ReminderCopyItem, build_reminder_copy_vars

item = ReminderCopyItem(schedule_key='k1', kind='TRIP_DAY', date_label='2026-09-13',
                        slot_names=('성산일출봉', '우도'))
prompt, ref = PromptRegistry(Path('prompts')).render(
    LlmFeature.REMINDER_COPY, build_reminder_copy_vars(item, '제주 3일'))
assert '성산일출봉' in prompt and '\$' not in prompt, prompt
print('OK', ref.prompt_id, ref.version)
"
```
Expected: `OK REMINDER_COPY 0.1.0` — 변수명이 어긋나면 여기서 `ValueError` 로 잡힌다.

- [ ] **Step 7: 커밋**

```bash
git add ai/prompts/reminder_copy.yaml ai/src/trippilot/llm_gateway/workers/reminder_copy.py ai/tests/test_llm_gateway_reminder_copy_worker.py
git commit -m "feat(ai): REMINDER_COPY 프롬프트·워커 — 항목별 호출, 예산 관통, 부분 성공"
```

---

### Task 4: 경계 개통

**Files:**
- Modify: `ai/src/trippilot/api/schemas.py` (파일 끝, Reflection 스키마 아래)
- Modify: `ai/src/trippilot/api/routes.py` (파일 끝)
- Modify: `ai/src/trippilot/api/app.py` (`include_router`)
- Modify: `ai/src/trippilot/api/wiring.py` (핸들러 + 조립)
- Modify: `ai/tests/test_api_openapi_contract.py` (경로 전수 목록)
- Modify: `ai/docs/openapi.json` (**재생성**), `ai/claude.md`, `ai/claude.ko.md`
- Test: `ai/tests/test_api_notification_boundary.py`

**Interfaces:**
- Consumes: `ReminderCopyWorker`·`ReminderCopyInput`·`ReminderCopyItem` (Task 3)
- Produces: `POST /ai/v1/notification/copies` — 백엔드(TRIP-836)가 부르는 계약
  - 요청: `{request_meta, trip_title, items[{schedule_key, kind, date, slots[{name, category}]}]}`
  - 응답: `{copies[{schedule_key, title, body}], degraded, fallback_mode}`
  - **예산은 `request_meta.deadline_ms`** 를 쓴다 — 새 `budget_ms` 필드를 만들지 않는다(기존 예산 전파 규약 재사용, 미지정이면 시간 제약 없음)

- [ ] **Step 1: 실패하는 경계 테스트를 쓴다**

Create `ai/tests/test_api_notification_boundary.py`:

```python
"""POST /ai/v1/notification/copies — 리마인드 문구 경계.

증명하는 것:
  ① 성공 항목만 copies 에 담기고, 빠진 게 있으면 degraded=true (침묵 금지 — INV-4)
  ② 전부 실패해도 200 + 빈 copies + fallback_mode="backend_constant" (백엔드가 상수로 보낸다)
  ③ 구형 조립(핸들러 없음)은 503 명시 실패
  ④ 응답 스키마에 시각·duration 필드가 없다 (INV-3)
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from trippilot.api.app import create_app

URL = "/ai/v1/notification/copies"

REQUEST = {
    "request_meta": {"request_id": "r-1", "requested_at": "2026-09-12T09:00:00Z", "deadline_ms": 8000},
    "trip_title": "제주 3일",
    "items": [
        {
            "schedule_key": "k1",
            "kind": "TRIP_DAY",
            "date": "2026-09-13",
            "slots": [{"name": "성산일출봉", "category": "관광지"}],
        }
    ],
}


def test_unwired_app_returns_503() -> None:
    client = TestClient(create_app())
    assert client.post(URL, json=REQUEST).status_code == 503


def test_response_has_no_time_fields() -> None:
    from trippilot.api.schemas import ReminderCopySchema

    fields = set(ReminderCopySchema.model_fields)
    assert fields == {"schedule_key", "title", "body"}
    assert not any("duration" in f or "time" in f for f in fields)
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd ai && uv run pytest tests/test_api_notification_boundary.py -q`
Expected: FAIL — 라우트가 없어 404(503 아님), 스키마 import 실패

- [ ] **Step 3: 경계 스키마를 추가한다**

`ai/src/trippilot/api/schemas.py` 파일 끝(`ReflectionNudgeResponse` 아래)에 추가:

```python
# ───────────────────── 리마인드 알림 문구 (notification) ─────────────────────


class ReminderSlotSchema(BoundaryModel):
    """그날 일정의 장소 1건 — 문구가 말해도 되는 대상. 좌표·시각은 싣지 않는다."""

    name: str = Field(min_length=1)
    category: str = ""


class ReminderCopyItemSchema(BoundaryModel):
    """예약 1건 = 문구 1건. schedule_key 는 백엔드 예약 행 식별자(불투명 문자열)."""

    schedule_key: str = Field(min_length=1)
    kind: Literal["TRIP_DAY", "TRIP_PRE"]
    date: dt.date
    slots: list[ReminderSlotSchema] = Field(default_factory=list)


class ReminderCopyRequest(BoundaryModel):
    """여행 1건의 예약 여러 행을 한 번에. 예산은 request_meta.deadline_ms 를 쓴다."""

    request_meta: RequestMetaSchema
    trip_title: str = ""
    items: list[ReminderCopyItemSchema] = Field(min_length=1, max_length=30)


class ReminderCopySchema(BoundaryModel):
    schedule_key: str
    title: str
    body: str


class ReminderCopyResponse(BoundaryModel):
    """빠진 항목은 백엔드가 기존 상수로 채운다 — degraded 가 그 사실의 증빙(INV-4)."""

    copies: list[ReminderCopySchema]
    degraded: bool
    fallback_mode: str | None = None
```

`Literal` import 가 없으면 파일 상단 `from typing import ...` 에 추가한다.

- [ ] **Step 4: wiring 에 핸들러와 조립을 추가한다**

`ai/src/trippilot/api/wiring.py`:

(a) 상단 import 에 추가:

```python
from trippilot.llm_gateway.gates.reminder_copy import ReminderCopyGate
from trippilot.llm_gateway.workers.reminder_copy import (
    ReminderCopyInput,
    ReminderCopyItem,
    ReminderCopyWorker,
)
```

(b) `WiredItineraryOrchestrator.__init__` 에 `reminder_copy_worker` 인자를 추가하고 `self._reminder_copy_worker` 로 보관한다(기존 `nudge_worker` 와 같은 형).

(c) `reflection_nudge` 메서드 **아래**에 핸들러를 추가:

```python
    def reminder_copy(
        self, request: schemas.ReminderCopyRequest
    ) -> schemas.ReminderCopyResponse:
        """리마인드 알림 문구 배치 — 실패분은 빼고 degraded 로 알린다 (INV-4).

        폴백 문구를 여기서 만들지 않는다: 빠진 자리는 백엔드가 기존 하드코딩 상수로
        채우므로, 이 경계의 폴백 모드는 "backend_constant" 다.
        """
        meta = request.request_meta
        budget_sec = None if meta.deadline_ms is None else meta.deadline_ms / 1000
        copies, dropped = self._reminder_copy_worker.generate(
            ReminderCopyInput(
                trip_title=request.trip_title,
                items=tuple(
                    ReminderCopyItem(
                        schedule_key=item.schedule_key,
                        kind=item.kind,
                        date_label=item.date.isoformat(),
                        slot_names=tuple(s.name for s in item.slots),
                    )
                    for item in request.items
                ),
            ),
            TraceId(meta.request_id),
            _tz_aware(meta.requested_at, self._tz),
            budget_sec=budget_sec,
        )
        if dropped:
            self._trace.emit(FallbackEvent(
                trace_id=TraceId(meta.request_id),
                occurred_at=_tz_aware(meta.requested_at, self._tz),
                component="api.wiring",
                stage="agent",
                from_mode="llm_reminder_copy",
                to_mode="backend_constant",
                reason=f"reminder_copy_dropped: {dropped}/{len(request.items)}",
            ))
        return schemas.ReminderCopyResponse(
            copies=[
                schemas.ReminderCopySchema(
                    schedule_key=c.schedule_key, title=c.title, body=c.body
                )
                for c in copies
            ],
            degraded=bool(dropped),
            fallback_mode="backend_constant" if dropped else None,
        )
```

(d) `build_orchestrator` 안 `nudge_worker = ReflectionNudgeWorker(...)` 블록 **바로 아래**에 추가(리베이스 hunk 인접 회피):

```python
    reminder_copy_worker = ReminderCopyWorker(
        GatewayFacade(llm, renderer, ReminderCopyGate(), c1_config, trace)
    )
```

그리고 `WiredItineraryOrchestrator(...)` 생성 지점에 `reminder_copy_worker=reminder_copy_worker` 를 넘긴다.

- [ ] **Step 5: 라우트를 추가한다**

`ai/src/trippilot/api/routes.py` 파일 끝에 추가:

```python
notification_router = APIRouter(prefix="/ai/v1/notification", tags=["notification"])


@notification_router.post("/copies", response_model=ReminderCopyResponse)
def notification_copies(
    request: ReminderCopyRequest,
    orchestrator: ItineraryOrchestrator = Depends(get_orchestrator),
) -> ReminderCopyResponse:
    """리마인드 알림 문구 배치 생성 (설계: specs/2026-09-08-reminder-copy-local-llm-design.md).

    생성 실패·게이트 드롭 항목은 copies 에서 빠지고 degraded=true 로 알린다 —
    그 자리는 백엔드가 기존 하드코딩 상수로 채운다(INV-4, 침묵 금지).
    구형 조립은 503 명시 실패.
    """
    handler = getattr(orchestrator, "reminder_copy", None)
    if handler is None:
        raise orchestrator_not_wired()
    return _guarded(lambda: handler(request))
```

`from trippilot.api.schemas import (...)` 목록에 `ReminderCopyRequest`·`ReminderCopyResponse` 를 추가하고, 파일 상단 docstring 의 경계 목록에 `+ POST /ai/v1/notification/copies` 를 더한다.

- [ ] **Step 6: 앱에 라우터를 등록한다**

`ai/src/trippilot/api/app.py` 의 `app.include_router(reflection_router)` 아래:

```python
    app.include_router(notification_router)  # 리마인드 알림 문구 경계
```

import 에 `notification_router` 추가.

- [ ] **Step 7: 계약 경로 목록을 갱신한다**

`ai/tests/test_api_openapi_contract.py` 의 `assert set(doc["paths"]) == {...}` 에 한 줄 추가:

```python
        "/ai/v1/notification/copies",       # 리마인드 알림 문구
```

- [ ] **Step 8: openapi 를 재생성한다**

```bash
cd ai && uv run python scripts/export_openapi.py
```
Expected: `docs/openapi.json` 이 갱신된다. **손으로 고치지 않는다.**

- [ ] **Step 9: 테스트 전체를 돌린다**

Run: `cd ai && uv run pytest -q`
Expected: PASS — 신규 경계 테스트 포함 전부 초록. 계약 테스트가 깨지면 8단계 재생성을 빠뜨린 것이다.

- [ ] **Step 10: 문서 2종을 갱신한다**

`ai/claude.md` 와 `ai/claude.ko.md` 의 "Current Status" 경계 목록에 `POST /ai/v1/notification/copies` 를 더한다(양쪽 같은 내용).

- [ ] **Step 11: 커밋**

```bash
git add ai/src/trippilot/api ai/tests/test_api_notification_boundary.py ai/tests/test_api_openapi_contract.py ai/docs/openapi.json ai/claude.md ai/claude.ko.md
git commit -m "feat(ai): 리마인드 알림 문구 경계 개통 — POST /ai/v1/notification/copies"
```

---

### Task 5: 로컬 LLM 라우팅

**Files:**
- Modify: `ai/main.py`
- Modify: `docker-compose.yml` (ai 서비스 environment)
- Modify: `.env.example`
- Test: `ai/tests/test_wiring_env.py`

**Interfaces:**
- Consumes: `LlmFeature.REMINDER_COPY` (Task 1)
- Produces: `_local_route(feature_models) -> dict[str, object]` — `main.py` 내부 헬퍼. `local*` 모델이 배정돼 있으면 `{"local": OpenAIAdapter(...)}`, 없으면 `{}`. 배정됐는데 주소가 없으면 `RuntimeError`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`ai/tests/test_wiring_env.py` 에 추가:

```python
def test_local_model_without_base_url_fails_startup(monkeypatch) -> None:
    """local* 모델을 배정했는데 주소가 없으면 조용히 기본 벤더로 나가지 않는다 — 기동 실패."""
    import main

    monkeypatch.setenv("TRIPPILOT_LLM_FEATURE_MODELS", "REMINDER_COPY=local-reminder-v1")
    monkeypatch.delenv("TRIPPILOT_LOCAL_LLM_BASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="TRIPPILOT_LOCAL_LLM_BASE_URL"):
        main._local_route(main._feature_models_from_env())


def test_no_local_model_means_no_local_route(monkeypatch) -> None:
    import main

    monkeypatch.setenv("TRIPPILOT_LLM_FEATURE_MODELS", "EXPLANATION=claude-haiku-4-5")
    monkeypatch.delenv("TRIPPILOT_LOCAL_LLM_BASE_URL", raising=False)
    assert main._local_route(main._feature_models_from_env()) == {}
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd ai && uv run pytest tests/test_wiring_env.py -q -k local`
Expected: FAIL — `AttributeError: module 'main' has no attribute '_local_route'`

- [ ] **Step 3: main.py 에 로컬 라우트를 추가한다**

`_mixed_llm_and_model` 아래에 추가:

```python
_LOCAL_PREFIX = "local"


def _local_route(feature_models: Mapping[LlmFeature, str]) -> dict[str, object]:
    """`local*` 모델이 배정돼 있으면 로컬 서버 어댑터 라우트를 만든다.

    로컬 서버는 OpenAI 호환(vLLM·MLX)이라 어댑터 신규 구현이 없다 — 기존
    OpenAIAdapter 에 base_url 만 갈아끼운다. `api="chat"` 고정: responses 표면은
    OpenAI 전용이다.

    **배정됐는데 주소가 없으면 기동 실패다**(설정 버그). 조용히 기본 벤더로 나가면
    파인튜닝 모델이 안 붙은 채 정상처럼 보인다 — 그 침묵이 이 분기의 존재 이유다.
    런타임 연결 실패는 다른 이야기고, 그쪽은 폴백 계단이 받는다(INV-4).
    """
    if not any(str(m).lower().startswith(_LOCAL_PREFIX) for m in feature_models.values()):
        return {}
    base_url = _env("TRIPPILOT_LOCAL_LLM_BASE_URL")
    if not base_url:
        raise RuntimeError(
            "local* 모델이 TRIPPILOT_LLM_FEATURE_MODELS 에 배정됐는데 "
            "TRIPPILOT_LOCAL_LLM_BASE_URL 미설정 — 기본 벤더로 조용히 나가지 않는다"
        )
    import openai

    from trippilot.llm_gateway.adapters.openai_adapter import OpenAIAdapter

    client = openai.OpenAI(
        api_key=_env("TRIPPILOT_LOCAL_LLM_API_KEY") or "local",  # 로컬 서버는 키를 안 본다
        base_url=base_url,
        max_retries=0,
    )
    return {_LOCAL_PREFIX: OpenAIAdapter(client, api="chat")}
```

파일 상단에 `from collections.abc import Mapping` 과 `from trippilot.domain.llm import LlmFeature` 가 없으면 추가한다.

- [ ] **Step 4: build_app_from_env 에서 라우트를 씌운다**

`build_app_from_env` 의 provider 분기 **아래**, `return build_dev_app(...)` **위**에 추가:

```python
    feature_models = _feature_models_from_env()
    local_routes = _local_route(feature_models)
    if local_routes:
        from trippilot.llm_gateway.adapters.routing import RoutingLlm

        # mixed 면 이미 RoutingLlm 이다 — 바깥에서 local 접두어만 가로채고 나머지는
        # 안쪽 라우터에 위임한다(합성). 접두어가 겹치지 않으므로 순서 의존이 없다.
        llm = RoutingLlm(default=llm, routes=local_routes)
```

그리고 아래 `build_dev_app(...)` 호출의 `feature_models=_feature_models_from_env()` 를 `feature_models=feature_models` 로 바꾼다(같은 값을 두 번 파싱하지 않는다).

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd ai && uv run pytest tests/test_wiring_env.py -q`
Expected: PASS

- [ ] **Step 6: compose 통로를 뚫는다**

`docker-compose.yml` 의 `ai` 서비스 `environment` 에서 `TRIPPILOT_LLM_RETRY_MODELS` 줄 아래에 추가:

```yaml
      # 파인튜닝 로컬 LLM (REMINDER_COPY) — OpenAI 호환 서버 주소.
      # 앱은 TRIPPILOT_* 만 읽는다. 이 통로가 빠지면 .env 에 값을 넣어도 조용히 무시된다.
      TRIPPILOT_LOCAL_LLM_BASE_URL: ${AI_LOCAL_LLM_BASE_URL:-}
      TRIPPILOT_LOCAL_LLM_API_KEY: ${AI_LOCAL_LLM_API_KEY:-}
```

`.env.example` 에 추가:

```bash
# 파인튜닝 로컬 LLM (REMINDER_COPY) — 예: Modal 배포 주소 또는 개발 중 http://host.docker.internal:8080/v1
# 모델명은 서빙의 --served-model-name 과 **정확히 일치**해야 한다(접두어가 그대로 model= 로 나간다).
AI_LOCAL_LLM_BASE_URL=
AI_LOCAL_LLM_API_KEY=
# AI_LLM_FEATURE_MODELS=REMINDER_COPY=local-reminder-qwen3-4b-v1
```

- [ ] **Step 7: 실스택 스모크 스크립트를 만든다**

서빙된 모델이 우리 프롬프트·게이트를 실제로 통과하는지 확인하는 유일한 수단이다.
`scripts/smoke_llm.py` 는 INTENT 전용으로 하드코딩돼 있어 건드리지 않고, 같은 형의
전용 스크립트를 새로 만든다. **수동·cron 전용 — CI 는 이 경로를 태우지 않는다.**

Create `ai/scripts/smoke_reminder_copy.py`:

```python
"""리마인드 문구 실스택 스모크 — 로컬 서빙 모델 1회 호출 + 게이트 통과 확인.

CI 밖 수동 실행. smoke_llm.py(INTENT 전용)와 같은 형이고, 다른 것은 셋뿐이다:
어댑터가 로컬 OpenAI 호환 서버를 보고, 프롬프트가 REMINDER_COPY 이고, 게이트가
장소 대조 컨텍스트를 받는다.

사용:
    export TRIPPILOT_LOCAL_LLM_BASE_URL=http://127.0.0.1:8080/v1
    export TRIPPILOT_LOCAL_LLM_MODEL=local-reminder-qwen3-4b-v1
    python scripts/smoke_reminder_copy.py
"""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.llm_gateway.gates.reminder_copy import ReminderCopyContext, ReminderCopyGate
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.reminder_copy import (
    ReminderCopyItem,
    build_reminder_copy_vars,
)
from trippilot.ports.llm_port import LlmRequest

_PROMPTS_DIR = Path(__file__).resolve().parents[1] / "prompts"
_SLOTS = ("성산일출봉", "우도")


def main() -> int:
    base_url = os.environ.get("TRIPPILOT_LOCAL_LLM_BASE_URL")
    model_id = os.environ.get("TRIPPILOT_LOCAL_LLM_MODEL")
    if not base_url or not model_id:
        print("TRIPPILOT_LOCAL_LLM_BASE_URL·TRIPPILOT_LOCAL_LLM_MODEL 필요", file=sys.stderr)
        return 2

    import openai

    from trippilot.llm_gateway.adapters.openai_adapter import OpenAIAdapter

    adapter = OpenAIAdapter(
        openai.OpenAI(
            api_key=os.environ.get("TRIPPILOT_LOCAL_LLM_API_KEY") or "local",
            base_url=base_url,
            max_retries=0,
        ),
        api="chat",
    )

    item = ReminderCopyItem(
        schedule_key="smoke", kind="TRIP_DAY", date_label="2026-09-13", slot_names=_SLOTS
    )
    prompt, ref = PromptRegistry(_PROMPTS_DIR).render(
        LlmFeature.REMINDER_COPY, build_reminder_copy_vars(item, "제주 3일")
    )
    print(f"[smoke] model={model_id} prompt={ref.prompt_id}@{ref.version}")

    try:
        response = adapter.invoke(
            LlmRequest(
                model_id=model_id,
                prompt=prompt,
                prompt_ref=ref,
                max_tokens=300,
                temperature=0.0,
                timeout_sec=float(os.environ.get("SMOKE_TIMEOUT_SEC", "60")),
            )
        )
    except Exception as e:  # 벤더 예외는 그대로 새어 나온다 — 여기서 보고
        print(f"[smoke] FAIL {type(e).__name__}: {e}")
        return 1

    print(f"[smoke] latency={response.latency_ms}ms raw={response.raw_text!r}")
    outcome = ReminderCopyGate().apply(
        response.raw_text,
        ReminderCopyContext(allowed=_SLOTS, forbidden=("한라산",)),
        feature=LlmFeature.REMINDER_COPY,
        trace_id=TraceId("smoke-reminder"),
        now=datetime.now(UTC),
    )
    if outcome.value is None:
        print(f"[smoke] FAIL 게이트 드롭: {outcome.error}")
        return 1
    print(f"[smoke] PASS title={outcome.value.title!r} body={outcome.value.body!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 8: 스크립트가 로드되는지 확인**

Run: `cd ai && uv run python -m py_compile scripts/smoke_reminder_copy.py && echo OK`
Expected: `OK` (실행은 서빙 모델이 뜬 뒤 — Task 7 §4)

- [ ] **Step 9: 전체 테스트**

Run: `cd ai && uv run pytest -q`
Expected: PASS

- [ ] **Step 10: 커밋**

```bash
git add ai/main.py ai/tests/test_wiring_env.py ai/scripts/smoke_reminder_copy.py docker-compose.yml .env.example
git commit -m "feat(ai): 로컬 LLM 라우트 — local 접두어 배정, 주소 미설정 시 기동 실패, 실스택 스모크"
```

---

### Task 6: 학습 데이터 생성 파이프라인

CI 밖에서 수동 실행하는 스크립트다. **필터는 Task 2 의 게이트를 그대로 import 한다** — 규칙을 두 벌 만들면 학습 데이터와 런타임 판정이 갈라진다.

**Files:**
- Create: `ai/scripts/finetune_reminder/build_dataset.py`
- Create: `ai/scripts/finetune_reminder/README.md`
- Test: `ai/tests/test_finetune_reminder_filter.py`

**Interfaces:**
- Consumes: `ReminderCopyGate`·`ReminderCopyContext` (Task 2), `build_reminder_copy_vars`·`ReminderCopyItem` (Task 3)
- Produces: `filter_samples(raw: Iterable[dict]) -> tuple[list[dict], dict[str, int]]` — (통과분, 사유별 탈락 수)

- [ ] **Step 1: 실패하는 필터 테스트를 쓴다**

Create `ai/tests/test_finetune_reminder_filter.py`:

```python
"""학습 데이터 필터 — 런타임 게이트와 **같은 코드**로 거른다.

규칙이 갈라지면 학습 분포와 서빙 판정이 어긋나 통과율이 조용히 떨어진다.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "finetune_reminder"))

from build_dataset import filter_samples  # noqa: E402


def _sample(body: str, places: list[str]) -> dict:
    return {
        "slot_names": ["성산일출봉", "우도"],
        "other_names": ["한라산"],
        "title": "오늘의 제주",
        "body": body,
        "places": places,
    }


def test_valid_sample_passes() -> None:
    kept, stats = filter_samples([_sample("성산일출봉에서 시작하는 하루예요", ["성산일출봉"])])
    assert len(kept) == 1 and stats["dropped"] == 0


def test_forbidden_token_sample_dropped() -> None:
    kept, stats = filter_samples([_sample("30분이면 도착해요", [])])
    assert kept == [] and stats["dropped"] == 1


def test_other_day_place_dropped() -> None:
    kept, stats = filter_samples([_sample("한라산이 보이네요", [])])
    assert kept == [] and stats["dropped"] == 1
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd ai && uv run pytest tests/test_finetune_reminder_filter.py -q`
Expected: FAIL — `ModuleNotFoundError: build_dataset`

- [ ] **Step 3: 데이터 생성 스크립트를 만든다**

Create `ai/scripts/finetune_reminder/build_dataset.py`:

```python
"""리마인드 문구 학습 데이터 생성 — 교사 호출 → 결정론 필터 → JSONL.

**CI 밖 수동 실행**이다. 교사는 오픈 웨이트 모델만 쓴다(Qwen3-235B, Apache-2.0):
Anthropic·OpenAI 이용약관은 그 출력물로 **어떤 모델이든** 사전 승인 없이 학습하는
것을 금지한다 — 경쟁 여부와 무관하다. 심판 LLM 은 완성품 평가에만 쓰고 **데이터
선별에는 쓰지 않는다**(선별에 개입하면 그 출력이 학습에 흘러든다).

필터는 서빙 게이트를 그대로 부른다 — 규칙 이중 구현 금지.

사용:
    export OPENROUTER_API_KEY=...
    python build_dataset.py --scenarios scenarios.json --out dataset.jsonl --per-scenario 3
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from trippilot.domain.common import TraceId  # noqa: E402
from trippilot.domain.llm import LlmFeature  # noqa: E402
from trippilot.llm_gateway.gates.reminder_copy import (  # noqa: E402
    ReminderCopyContext,
    ReminderCopyGate,
)

TEACHER_MODEL = "qwen/qwen3-235b-a22b-instruct"  # 오픈 웨이트(Apache-2.0)
OPENROUTER_URL = "https://openrouter.ai/api/v1"
_NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def filter_samples(raw: Iterable[dict]) -> tuple[list[dict], dict[str, int]]:
    """게이트를 통과한 샘플만 남긴다. 반환: (통과분, {"kept": n, "dropped": n})."""
    gate = ReminderCopyGate()
    kept: list[dict] = []
    dropped = 0
    for sample in raw:
        payload = json.dumps(
            {
                "title": sample.get("title", ""),
                "body": sample.get("body", ""),
                "places": sample.get("places", []),
            },
            ensure_ascii=False,
        )
        ctx = ReminderCopyContext(
            allowed=tuple(sample.get("slot_names", ())),
            forbidden=tuple(sample.get("other_names", ())),
        )
        outcome = gate.apply(
            payload,
            ctx,
            feature=LlmFeature.REMINDER_COPY,
            trace_id=TraceId("finetune"),
            now=_NOW,
        )
        if outcome.value is None:
            dropped += 1
            continue
        kept.append(sample)
    return kept, {"kept": len(kept), "dropped": dropped}


def _call_teacher(client, prompt: str, temperature: float) -> str:
    response = client.chat.completions.create(
        model=TEACHER_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
        max_tokens=300,
    )
    return response.choices[0].message.content or ""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenarios", required=True, help="시나리오 JSON (일정 샘플 목록)")
    parser.add_argument("--out", required=True, help="출력 JSONL")
    parser.add_argument("--per-scenario", type=int, default=3, help="시나리오당 생성 수")
    parser.add_argument("--temperature", type=float, default=1.0, help="다양성 확보용 — 높게")
    args = parser.parse_args()

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("OPENROUTER_API_KEY 미설정", file=sys.stderr)
        return 2

    import openai

    from trippilot.llm_gateway.workers.reminder_copy import (
        ReminderCopyItem,
        build_reminder_copy_vars,
    )

    client = openai.OpenAI(api_key=api_key, base_url=OPENROUTER_URL)
    template = (Path(__file__).resolve().parents[2] / "prompts" / "reminder_copy.yaml").read_text(
        encoding="utf-8"
    )
    body = template.split("template: |", 1)[1]

    scenarios = json.loads(Path(args.scenarios).read_text(encoding="utf-8"))
    raw: list[dict] = []
    for scenario in scenarios:
        item = ReminderCopyItem(
            schedule_key=scenario["schedule_key"],
            kind=scenario["kind"],
            date_label=scenario["date"],
            slot_names=tuple(scenario["slot_names"]),
        )
        prompt = body
        for key, value in build_reminder_copy_vars(item, scenario.get("trip_title", "")).items():
            prompt = prompt.replace(f"${key}", value)
        for _ in range(args.per_scenario):
            try:
                parsed = json.loads(_call_teacher(client, prompt, args.temperature))
            except (ValueError, KeyError) as e:
                print(f"skip: {e}", file=sys.stderr)
                continue
            raw.append(
                {
                    "prompt": prompt,
                    "slot_names": list(scenario["slot_names"]),
                    "other_names": list(scenario.get("other_names", [])),
                    "title": parsed.get("title", ""),
                    "body": parsed.get("body", ""),
                    "places": parsed.get("places", []),
                }
            )

    kept, stats = filter_samples(raw)
    seen: set[tuple[str, str]] = set()
    with Path(args.out).open("w", encoding="utf-8") as f:
        for sample in kept:
            key = (sample["title"], sample["body"])
            if key in seen:  # 같은 문구 반복은 학습 분포를 망친다
                continue
            seen.add(key)
            record = {
                "messages": [
                    {"role": "user", "content": sample["prompt"]},
                    {
                        "role": "assistant",
                        "content": json.dumps(
                            {
                                "title": sample["title"],
                                "body": sample["body"],
                                "places": sample["places"],
                            },
                            ensure_ascii=False,
                        ),
                    },
                ]
            }
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"원본 {len(raw)} → 통과 {stats['kept']} · 탈락 {stats['dropped']} · 중복제거 후 {len(seen)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd ai && uv run pytest tests/test_finetune_reminder_filter.py -q`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add ai/scripts/finetune_reminder/build_dataset.py ai/tests/test_finetune_reminder_filter.py
git commit -m "feat(ai): 리마인드 문구 학습 데이터 생성 — 교사 호출 + 서빙 게이트 재사용 필터"
```

---

### Task 7: 학습·변환·서빙 런북과 평가

**Files:**
- Create: `ai/scripts/finetune_reminder/README.md`
- Create: `ai/scripts/finetune_reminder/evaluate.py`

**Interfaces:**
- Consumes: `dataset.jsonl` (Task 6), 서빙 엔드포인트 (Task 5 의 env)
- Produces: 런북 문서 + `evaluate.py` (심판 채점 결과 표)

- [ ] **Step 1: 런북을 쓴다**

Create `ai/scripts/finetune_reminder/README.md`:

```markdown
# 리마인드 문구 파인튜닝 런북

설계: `ai/docs/superpowers/specs/2026-09-08-reminder-copy-local-llm-design.md`

모델 3종의 역할이 다르다 — **교사** Qwen3-235B(데이터 생성, 오픈 웨이트) ·
**학생** Qwen3-4B-Instruct-2507(우리가 학습·서빙) · **심판** Sonnet(완성품 평가 전용).
심판 출력은 학습에 절대 들어가지 않는다(약관: Anthropic·OpenAI 출력물로 어떤 모델도
사전 승인 없이 학습 금지).

## 1. 데이터 생성 (교사, OpenRouter ~$5)

    export OPENROUTER_API_KEY=...
    python build_dataset.py --scenarios scenarios.json --out dataset.jsonl --per-scenario 3

시나리오는 실제 수집 POI에서 뽑는다(`ai/collected_pois.db`). 목표는 필터 통과 후
2,500~3,000건. 통과율이 60% 아래면 프롬프트를 손본다.

## 2. 학습 (Mac, MLX LoRA)

    pip install mlx-lm
    mlx_lm.lora --model Qwen/Qwen3-4B-Instruct-2507 --train \
        --data ./data --batch-size 4 --iters 800 --adapter-path ./adapters

`--data` 디렉토리에 `train.jsonl`·`valid.jsonl` 로 나눠 둔다(9:1).

## 3. 변환 (vLLM 서빙 형식)

    mlx_lm.fuse --model Qwen/Qwen3-4B-Instruct-2507 \
        --adapter-path ./adapters --save-path ./merged

MLX 산출물은 그대로는 vLLM에 안 올라간다 — `fuse` 로 베이스에 합쳐 HF safetensors
형식으로 떨군다. 여기서 막히면 같은 `dataset.jsonl` 로 Colab(표준 PEFT)에서 다시
학습한다. **데이터가 자산이고 학습 실행은 소모품이다.**

## 4. 서빙 (Modal 서버리스)

모델명은 반드시 `local-reminder-qwen3-4b-v1` — 앱이 보내는 `model=` 문자열과
서버의 `--served-model-name` 이 **정확히 일치**해야 한다. 접두어 `local` 이
라우팅을 결정한다.

    vllm serve ./merged --served-model-name local-reminder-qwen3-4b-v1

배포 후 `.env` 에:

    AI_LOCAL_LLM_BASE_URL=https://<modal-앱>.modal.run/v1
    AI_LLM_FEATURE_MODELS=REMINDER_COPY=local-reminder-qwen3-4b-v1

배포 직후 실스택 스모크로 확인한다(프롬프트·게이트까지 실제로 통과하는지):

    TRIPPILOT_LOCAL_LLM_BASE_URL=<주소> TRIPPILOT_LOCAL_LLM_MODEL=local-reminder-qwen3-4b-v1 \
        python ../smoke_reminder_copy.py

콜드스타트(수십 초)는 무관하다 — 문구 채움은 알림 발화 몇 시간~며칠 전에 도는
비동기 작업이다.

## 5. 평가 (심판 Sonnet)

    export ANTHROPIC_API_KEY=...
    python evaluate.py --student student.jsonl --teacher teacher.jsonl --baseline baseline.jsonl

블라인드 비교 채점 + 사람 표본 20~30건 눈검수 병행. 결과 수치는 발표 자료용이고,
학습 루프에 되먹이지 않는다.
```

- [ ] **Step 2: 평가 스크립트를 만든다**

Create `ai/scripts/finetune_reminder/evaluate.py`:

```python
"""완성품 평가 — 학생 vs 교사 vs 기존 상수 블라인드 비교 (심판 Sonnet).

**평가 전용이다.** 이 점수는 학습 데이터 선별에도, 재학습 루프에도 들어가지 않는다
(약관 — 심판 출력의 학습 유입 0). 산출은 발표 자료용 표 하나다.

사용:
    export ANTHROPIC_API_KEY=...
    python evaluate.py --student student.jsonl --teacher teacher.jsonl --baseline baseline.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from pathlib import Path

JUDGE_MODEL = "claude-sonnet-5"
RUBRIC = """다음은 여행 알림 문구 후보 3개다. 같은 일정에 대한 것이다.
자연스러움·구체성·알림으로서의 유용성만 보고 가장 좋은 것 하나를 고르라.
이유는 쓰지 말고 A, B, C 중 한 글자만 출력하라.

일정: {slots}
A: {a}
B: {b}
C: {c}"""


def _load(path: str) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--student", required=True)
    parser.add_argument("--teacher", required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY 미설정", file=sys.stderr)
        return 2

    import anthropic

    client = anthropic.Anthropic()
    rng = random.Random(args.seed)
    rows = list(zip(_load(args.student), _load(args.teacher), _load(args.baseline)))
    wins = {"student": 0, "teacher": 0, "baseline": 0}

    for student, teacher, baseline in rows:
        labeled = [("student", student), ("teacher", teacher), ("baseline", baseline)]
        rng.shuffle(labeled)  # 위치 편향 제거
        prompt = RUBRIC.format(
            slots=" / ".join(student.get("slot_names", [])),
            a=labeled[0][1]["body"],
            b=labeled[1][1]["body"],
            c=labeled[2][1]["body"],
        )
        message = client.messages.create(
            model=JUDGE_MODEL,
            max_tokens=4,
            messages=[{"role": "user", "content": prompt}],
        )
        choice = (message.content[0].text or "").strip().upper()[:1]
        index = {"A": 0, "B": 1, "C": 2}.get(choice)
        if index is None:
            continue
        wins[labeled[index][0]] += 1

    total = sum(wins.values()) or 1
    print(f"표본 {len(rows)}건 · 유효 판정 {total}건")
    for name, count in sorted(wins.items(), key=lambda kv: -kv[1]):
        print(f"  {name:9s} {count:4d}건 ({count / total:.1%})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 3: 스크립트가 구문 오류 없이 로드되는지 확인**

Run: `cd ai && uv run python -m py_compile scripts/finetune_reminder/build_dataset.py scripts/finetune_reminder/evaluate.py && echo OK`
Expected: `OK`

- [ ] **Step 4: 전체 테스트 최종 확인**

Run: `cd ai && uv run pytest -q`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add ai/scripts/finetune_reminder/
git commit -m "docs(ai): 리마인드 문구 파인튜닝 런북 + 완성품 평가 스크립트"
```

---

## 완료 후

- [ ] PR 을 `develop` 으로 연다. **본문에 Jira 키를 쓰지 않는다**(자동화가 TRIP-836 을 오닫는다) — 제목으로만 언급한다.
- [ ] TRIP-836 에 "AI 경계 머지됨, `ai/docs/openapi.json` 이 계약 정본" 코멘트를 남긴다.
- [ ] 준비물 안내: OpenRouter 가입 + $5(Task 6 실행 직전), Modal 가입(Task 7 §4 직전).
