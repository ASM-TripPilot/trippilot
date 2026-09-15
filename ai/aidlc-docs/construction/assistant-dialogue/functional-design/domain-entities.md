# 도우미 대화 — 도메인 엔티티 (FD **초안**)

> **초안이다.** 승인 게이트 전이고, 정본을 **수정하지 않는다** — 필요한 개정은 business-rules §4 에 목록으로만 올린다.
>
> 다루는 것은 셋이고, 따로 쓰지 않고 한 유닛으로 묶은 이유는 §0 이다.
> ③ **인자 추출**(도구 호출 형태의 3차 포함) · ④ **다중 의도** · ⑤ **멀티턴**
>
> **유닛 번호를 붙이지 않는다.** 모노레포 정본(`aidlc/aidlc-docs/inception/application-design/unit-of-work.md`)은
> 이 영역을 **U8 Conversational Assistant**(Phase 7+, 후속 게이트)라 부르고, ai 패키지 정본
> (`ai/aidlc-docs/inception/units/unit-of-work.md`)은 U1~U6 까지만 쓴다. 번호가 충돌하면 이름으로 적는 것이
> 팀 규칙이다(`docs/conventions/anti-patterns.md` §설계·문서). `agent-foundation` 과 같은 표기 방식이다.
>
> 근거 정본: `intent-matching-design.md`(3단 파이프라인·§2 [슬롯 추출]·§3.1·§5) ·
> `orchestrator-delegation-design.md`(§5 라우팅 표·§182 복합 intent) · `agent-redesign.md` §예시2(병렬 규칙) ·
> `agent-io-contracts.md`(`EditAgentOutput.clarification_needed`) · `agent-foundation` FD(봉투·DL-1~5·BR-AF-*) ·
> 제품 정본 `aidlc/aidlc-docs/inception/requirements/requirements.md` FR-ASSIST-01 · `user-stories/stories.md` 에픽 J ·
> `application-design/components.md` C16 `AssistantFacade`.

---

## 0. 왜 셋을 한 유닛으로 묶나

세 항목은 **같은 하나**를 세 방향에서 본 것이다.

발화 하나는 **N개의 프레임**을 낳고, 프레임 하나는 `(의도, 인자)` 이며, 프레임은 **필수 인자가 다 찼을 때만 실행 가능**하다.

| 항목 | 같은 문장으로 쓰면 |
|---|---|
| ③ 인자 추출 | 프레임 하나의 인자를 채우는 일 |
| ④ 다중 의도 | N > 1 인 경우 |
| ⑤ 멀티턴 | 인자가 덜 찬 프레임이 **다음 턴까지 살아남는** 경우 |

멀티턴이 존재하는 이유가 "인자가 비었다" 이므로 ③ 없이 ⑤를 설계할 수 없고, ④는 프레임이 여러 개 생기는 것뿐이다.
따라서 새 엔티티의 중심은 하나다 — **`IntentFrame`**. 유닛을 쪼개면 이 타입을 세 번 정의하게 된다.

제품 정본도 셋을 한 묶음으로 본다: FR-ASSIST-01 이 한 문장 안에 "**재질의**·진행 검토·액션 위임·**이력**"을 함께 적었고,
에픽 J 의 스토리 목록에 "2) 대화형 재질의(티키타카)"와 "5) 대화 이력·세션"이 나란히 있다.

---

## 0.1 지금 있는 것 / 없는 것 — 실측

이 표가 이 FD 의 출발선이다. **"설계에 있다"와 "코드에 있다"를 섞지 않는다.**

| | 상태 | 위치 |
|---|---|---|
| `Intent` 13종 + `OUT_OF_SCOPE` · `ROUTING_TABLE`(handler·mode) · `MatchRoute` 4종 | **실재** | `domain/intent.py` |
| `AgentTask`/`AgentResult`/`spawn`/`AgentStatus` 봉투 | **실재** | `domain/delegation.py:144, :258` |
| `ExecutionPlan`·`ExecutionStep`·`AgentCall`·`AgentKind` | **타입만 실재 · 프로덕션 소비자 0** — 임포트는 테스트 2곳뿐 | `domain/execution.py` |
| 3단 라우터·질문뱅크 417문장·게이트 2종 | **실재 · 프로덕션 호출자 0** (`api/wiring.py` 가 `IntentRouter` 를 임포트하지 않는다) | `orchestrator/intent_router.py` |
| 인자(슬롯) 추출 | **사실상 없다** — `_extract_slots` 는 엔트리의 `slot_pattern` 을 읽는데 뱅크 417문장에 그 키가 **0건**이라 1·2차는 **항상 `slots={}`** | `intent_router.py:376` |
| 3차의 인자 어휘 | **의도 13종 공통으로 `date`·`category`·`constraint` 3개뿐** — 의도별 스키마가 어디에도 없다 | `prompts/intent.yaml:36` |
| 발화 → 명령 번역의 **작동 선례** | **실재** — `EDIT_TRANSLATION` 워커·게이트 | `llm_gateway/workers/edit_translation.py` |
| 도구 호출 | **없다** — `LlmRequest` 는 `prompt`·`images`, `LlmResponse` 는 `raw_text` 뿐 | `ports/llm_port.py` |
| 다중 의도 분해 | **없다** — 라우터는 발화 1 → 의도 1. 2차 투표는 의도 혼재를 **해소할 모호성**으로 다루지 분해하지 않는다 | `intent_router.py` `_vote` |
| 대화·세션·턴 저장소 | **양쪽 서비스 어디에도 없다.** `PlaceProvider` 의 "세션 캐시"는 프로세스 안 LRU 32칸(요청 스코프)이고, 백엔드의 `*_session` 테이블 3종은 인증·생성진행·재계획 초안이다 | — |
| 사용자 되묻기 | **설계에만** — `EditAgentOutput.clarification_needed` 는 `agent-io-contracts.md:232` 에만 있고 `src/` 에 0건 | — |
| `AgentStatus.NEED_MORE_INFO` | **enum·검증기만** — 생산처 0 · 소비처 0 | `domain/delegation.py:41, :291` |
| 자연어를 받는 경계 | **9개 경계 중 1개 필드 1개뿐** — `/ai/v1/itinerary/edit` 의 `utterance` | `api/schemas.py:446` |

**이 FD 가 새로 만드는 것은 `IntentFrame`·`ARGUMENT_TABLE`·`DialogueContext` 3종**이고, 나머지는 위 실재물의 확장이거나
**이미 있는데 아무도 안 쓰는 타입을 쓰는 일**이다(`ExecutionPlan`).

---

## 1. `IntentFrame` — 라우팅의 새 단위 (`domain/dialogue.py` 신규)

기존 `IntentMatch`(의도 1 + `slots: dict`)를 **대체하지 않고 감싼다**. `IntentMatch` 는 "어떻게 의도를 정했나"의 기록이고
`IntentFrame` 은 "무엇을 실행할 것인가"다. 한 타입에 합치면 다중 의도에서 프레임마다 `match_route` 가 다른 것을 표현하지 못한다.

```
IntentFrame (frozen, slots):
  intent: Intent
  arguments: dict                  # 이름 → 평면 스칼라 (str|int|float|bool) — IntentGate 규칙과 동형
  missing: tuple[str, ...]         # 아직 못 채운 **필수** 인자 이름 (ARGUMENT_TABLE 기준)
  confidence: float                # [0,1]
  match_route: MatchRoute          # 이 프레임의 의도를 정한 경로
  source_span: str | None          # 다중 의도에서 이 프레임을 만든 발화 조각 (단일이면 None)
  depends_on: int | None           # 앞 프레임의 순번 — 그 결과를 받고 실행 (없으면 None)

  @property
  def executable(self) -> bool:  return not self.missing
```

**post-init 불변식**

| 조건 | 강제 |
|---|---|
| `intent = OUT_OF_SCOPE` | `arguments`·`missing` 비어 있음 ∧ `match_route = FALLBACK` (기존 `IntentMatch` 규칙과 동형) |
| `match_route = FALLBACK` | `intent = OUT_OF_SCOPE` |
| `arguments` 값 | **평면 스칼라만** — `IntentGate._parse_slots` 가 이미 강제하는 규칙을 타입으로 올린다 |
| `missing` 원소 | 반드시 `ARGUMENT_TABLE[intent]` 의 `required=True` 인자 이름 ∧ 중복 없음 — 표에 없는 이름은 생성 불가 |
| `confidence` | `0.0 ≤ c ≤ 1.0`. **범위 밖은 잘라내지 않고 거부** — `IntentGate` 가 이미 그렇게 한다("'87'을 1.0으로 접으면 과신을 만들어낸다") |
| `depends_on` | `≥ 0` ∧ 자기 순번보다 작다 (순환 불가) |

`executable` 을 필드가 아니라 파생 속성으로 두는 이유: 둘을 따로 저장하면 어긋난 인스턴스가 만들어진다.

---

## 2. `ARGUMENT_TABLE` — 도구 스키마의 정본 (`domain/dialogue.py`)

의도 13종이 각각 **무엇을 알아야 실행되는가**의 표다. 이것이 곧 도구 호출의 도구 13종 스키마이고, 동시에 규칙 추출기의 대상 목록이다.
**한 곳에만 적는다** — 도구 스키마 JSON 과 추출기 목록을 따로 적으면 반드시 갈라진다.

지금 이 자리에 있는 것은 `prompts/intent.yaml:36` 의 **의도 무관 3칸**(`date`·`category`·`constraint`)뿐이다.
의도마다 필요한 것이 다른데 한 봉투를 쓰니, 프롬프트가 "발화에 실제로 등장한 표현만 담으세요"라고 방어할 수밖에 없다.
표가 생기면 그 방어가 **스키마**가 된다.

```
ArgumentKind (Enum):
  DATE          # 하루 — "오늘 · 내일 · 글피 · 9월 20일"
  DATE_RANGE    # 기간 — "3박 4일 · 20일부터 23일까지"
  REGION        # 행정구역/여행지 — "여수 · 제주"
  PLACE_REF     # 장소를 가리키는 **문자열** — "경복궁" (POI id 아님, BR-DLG-03)
  SLOT_REF      # 일정 안의 항목 지시 — "둘째 날 점심 · 다음 일정 · 마지막"
  ORDINAL       # 순번 — "2일 차 · 세 번째"
  COUNT         # 개수 — "두 곳 · 3개"
  ENUM          # 자체 closed-set 을 갖는 인자 — EditOp(진짜 enum) · PlanB reason(아직 주석 어휘, §2.1 †)
  FREE_TEXT     # 규칙으로 못 뽑는 자유 서술 — 사고 사유·취향 설명

ArgumentSpec (frozen): name: str · kind: ArgumentKind · required: bool · description: str
                       · choices: tuple[str, ...] = ()     # kind=ENUM 일 때만 비어있지 않다
ARGUMENT_TABLE: dict[Intent, tuple[ArgumentSpec, ...]]      # 13종 전수 (OUT_OF_SCOPE 제외)
```

### 2.1 표 (초안 — 값이 리뷰 대상이다)

`mode`·`처리자` 는 `ROUTING_TABLE`(실재 코드) 그대로다. 인자는 **초안**이고, 필수 판정의 기준은 하나다 —
**그 값이 없으면 처리자가 일을 시작조차 못 하는가.** `context_refs` 재조회나 Provider 수집으로 메울 수 있으면 선택이다.

| 의도 | mode · 처리자 | 필수 인자 | 선택 인자 |
|---|---|---|---|
| `GENERATE_SCHEDULE` | Delegate · ScheduleAgent | `region`(REGION) · `period`(DATE_RANGE) | `start_date`(DATE) · `companions`(FREE_TEXT) |
| `REGENERATE` | Delegate · ScheduleAgent | — (대상 일정은 `context_refs`) | `reason`(FREE_TEXT) · `keep`(SLOT_REF) |
| `REPLAN` | Delegate · PlanBAgent | — | `reason`(ENUM† `weather`·`closed`·`delay`·`canceled`·`fully_booked`·`fatigue`·`none`) · `from_slot`(SLOT_REF) |
| `SUGGEST_ALTERNATIVE` | Delegate · PlanBAgent | `target`(SLOT_REF \| PLACE_REF) | `reason`(ENUM† 위와 같음) · `count`(COUNT) |
| `GENERATE_REFLECTION` | Delegate · ReflectAgent | `date`(DATE) | `tone`(FREE_TEXT) |
| `TRIP_SUMMARY` | Delegate · ReflectAgent | — | `day_date`(DATE — 없으면 전체 요약) |
| `STYLE_ANALYSIS` | Delegate · ReflectAgent | — | — |
| `EDIT_SCHEDULE` | Delegate · EditAgent | `op`(ENUM: `EditOp` 7종) · `target`(SLOT_REF \| PLACE_REF) | `replacement`(PLACE_REF) · `day`(ORDINAL) · `position`(SLOT_REF) |
| `GET_NEXT_SLOT` | Fast Path · (DB) | — | `from_time`(DATE) |
| `SHOW_SCHEDULE` | Fast Path · (DB) | — | `day`(ORDINAL) · `date`(DATE) |
| `GET_WEATHER` | Fast Path · WeatherAgent | — | `date`(DATE) · `region`(REGION) |
| `GET_DISTANCE` | Fast Path · TransitAgent | `origin`(PLACE_REF \| SLOT_REF) · `destination`(PLACE_REF \| SLOT_REF) | — |
| `GET_POI_INFO` | Fast Path · PlaceScoutAgent | `place`(PLACE_REF) | `aspect`(FREE_TEXT — 영업시간·입장료·휴무·주차) |

† **아직 타입이 아니다** — 주석으로만 적힌 어휘다(아래 2번).

표가 말해 주는 것 넷.

1. **필수 인자가 하나도 없는 의도가 6종**(`REGENERATE`·`REPLAN`·`TRIP_SUMMARY`·`STYLE_ANALYSIS`·`GET_NEXT_SLOT`·
   `SHOW_SCHEDULE`)이다 — 의도만 맞히면 되고 **되묻기가 아예 필요 없다.** ⑤의 실제 적용 범위는 나머지 7종이다.
2. `ENUM` 인자는 **새 어휘를 만들지 않고 이미 있는 것을 가리킨다** — `EDIT_TRANSLATION` 프롬프트가
   서버 주입 `$edit_ops` 로 하는 것과 같은 방식이다. 다만 둘의 **강도가 다르다**:
   `EditOp` 는 진짜 enum(`domain/edit.py`)이고, PlanB `reason` 은 **`str` 필드에 주석으로만 적힌 어휘**다
   (`agents/planb/rag.py:167` · `api/schemas.py:358` — 둘 다 `weather|closed|…|none` 이 주석이다).
   표가 `choices` 를 가지려면 그 어휘가 타입이 되어야 한다 — 개정 목록(business-rules §4)에 올린다.
3. `GET_DISTANCE` 만 필수 인자가 **2개**다. 되묻기 설계의 최악 사례는 여기다.
4. `TRIP_SUMMARY.day_date` · `STYLE_ANALYSIS` 는 `agent-io-contracts.md:176-196` 에 있으나 `domain/reflection.py` 에
   **필드가 없다** — 표가 계약 쪽 정본을 따르고 코드 쪽 갭은 business-rules §5 미결로 올린다.

### 2.1.1 왜 `op` 를 **인자**로 두고 의도로 올리지 않나 (실측, 2026-09-15)

"의도를 더 쪼개면 뱅크가 더 확실히 갈린다"는 제안을 재 봤다. **갈리지 않았다.**

`EDIT_SCHEDULE` 31문장을 연산별로 나눠(ADD 8 · MOVE 7 · REPLACE 9 · REMOVE 3 · 분류불가 4)
같은 조건(평가셋 87 · `t_high` 0.82 · `intent_margin` 0.02)으로 1차를 다시 돌렸다.

| | 1차 확정 | 정답 | 오답 | EDIT ↔ REGENERATE·REPLAN 경계(≥0.80) | **새로 생긴 내부 경계** |
|---|---:|---:|---:|---:|---:|
| 현행 13종 | 28 | 28 | 0 | 9쌍 (최고 0.823) | — |
| `EDIT_*` 5종으로 쪼갬 | **28** | 28 | 0 | **9쌍 (최고 0.823)** | **12쌍 (최고 0.877)** |

**확정 건수도 경계 압력도 그대로이고, 내부 경계만 12쌍 새로 생긴다.** 그중 `EDIT_MOVE ↔ EDIT_REPLACE`
(0.877)는 쪼개기가 없애려던 외부 경계(0.823)보다 **더 붙어 있다** — "{장소}를 {장소}로 교체" 와
"{장소} 일정을 {날짜} 오전으로 재배치"는 연산이 다른데 말이 닮았다.

쪼개기가 **아무것도 못 고치는 진짜 이유**는 정보량이다. `op` 는 지금 `EDIT_TRANSLATION` 워커가
**현재 일정을 손에 들고** 정한다(`EditTranslationContext{pool, current_slots}`). 의도로 올리면 라우터가
**발화만 보고** 같은 판단을 하게 된다 — 결정을 더 이른 자리로, 더 적은 정보로 옮기는 것이다.

얻은 것이 없지는 않다. 쪼개 보니 `EDIT ↔ REGENERATE·REPLAN` 압력 9쌍 중 **7쌍이 `MOVE` 계열**에
몰려 있다("재배치·옮겨"가 재계획처럼 들린다). 이건 closed-set 을 건드릴 일이 아니라 **뱅크 위생의
표적**이다 — 그 7쌍만 손보면 된다.

### 2.2 표에서 **파생**되는 것 둘

```
tool_specs() -> tuple[ToolSpec, ...]         # 13개 도구 스키마 (③ 도구 호출용)
required_of(intent) -> tuple[str, ...]       # 필수 인자 이름 (IntentFrame.missing 계산용)
```

`tool_specs()` 는 표를 JSON Schema 로 옮기는 **순수 함수**다. 손으로 적은 스키마 파일을 두지 않는다.

---

## 3. 인자 추출기 — `ArgumentKind` 별 하나 (`orchestrator/arguments.py` 신규)

**`intent-matching-design.md` §3.1 의 엔트리별 `slot_pattern` 을 폐기하기를 제안한다.** 근거 셋:

- 뱅크가 417문장이고 증강으로 계속 는다. 문장마다 패턴을 달면 유지가 안 되고, **증강기는 패턴을 만들 수 없다.**
- 같은 `date` 인자를 의도마다 다른 정규식으로 뽑게 되어 한 곳만 고친 드리프트가 생긴다.
- **이미 실질 폐기 상태다** — 로더·라우터·정규식 추출기·테스트가 전부 있는데 데이터가 0건이다.
  "기능이 없다"가 아니라 "기능이 있는데 아무도 쓰지 않는다"는 편이 위험하다. 다음 사람이 채우려 들기 때문이다.

대신 **인자 종류마다 추출기 하나**를 둔다. 종류가 9개이므로 추출기도 9개면 끝이고, 의도가 늘어도 늘지 않는다.

```
Extractor = Callable[[str], str | None]      # 발화 → 값(원문 조각) 또는 None
EXTRACTORS: dict[ArgumentKind, Extractor]
```

| 종류 | 방법 | LLM |
|---|---|---|
| `DATE` · `DATE_RANGE` · `ORDINAL` · `COUNT` | 정규식 + 한국어 수사 표 | 0회 · 결정론 |
| `ENUM` | `choices` 어휘 표면형 대조 | 0회 · 결정론 |
| `REGION` | 지역명 사전 최장일치 (사전 정본은 place-data 소유 — 여기서는 참조만) | 0회 |
| `PLACE_REF` · `SLOT_REF` | 규칙으로는 **부분만** — 못 뽑으면 3차 승격 | 조건부 |
| `FREE_TEXT` | **규칙 불가** — 항상 3차 승격 | 1회 |

추출 실패가 라우팅을 죽이지 않는다 — 의도는 이미 정해졌고 인자만 빈다(`_extract_slots` 의 현행 방침 유지).

---

## 4. 도구 호출 — `LlmPort` 확장 (③)

### 4.1 왜 3차에만 붙는가

도구 호출은 **의도 라우터의 대체재가 아니라 3차 직접 분류의 구현 방식**이다.
`(도구 이름, 인자)` 와 `(의도, 인자)` 는 구조가 같으므로, 3차가 하던 "라벨 + 슬롯 JSON"을 벤더 스키마로 옮기는 것뿐이다.

1·2차는 임베딩이라 인자를 만들 수 없고, 여기에 LLM 을 넣으면 CONFIDENT 경로의 **유일한 존재 이유인 "LLM 0회"** 가 사라진다
(실측: 뱅크 417문장 기준 평가 발화 87건 중 28건이 LLM 0회로 끝난다). 그래서 도구 호출은 3차 전용이다.

### 4.2 포트 확장 — 후미 기본값 (이미지 선례 그대로)

`TRIP-595` 가 `LlmRequest.images` 를 후미 기본값으로 더해 기존 호출 전부를 무영향으로 둔 선례를 따른다.

```
ToolSpec (frozen): name: str · description: str · parameters: dict     # JSON Schema — ARGUMENT_TABLE 파생
ToolCall (frozen): name: str · arguments: dict                          # 벤더 응답 파싱분

LlmRequest  += tools: tuple[ToolSpec, ...] = ()       # 비면 기존 동작 그대로
            += tool_choice: str | None = None         # "required" | 도구 이름 | None
LlmResponse += tool_calls: tuple[ToolCall, ...] = ()  # 도구를 안 썼으면 빈 튜플
```

- **미지원 어댑터**: `tools` 가 비어있지 않은데 못 받으면 `LlmUnsupportedError` — 이미지와 **같은 자리**다.
  게이트웨이가 폴백 신호로 전환하고 호출측이 **기존 JSON 프롬프트 경로로 강등**한다(INV-4, 조용히 떨구지 않는다).
- **ports 순수성 유지**: `parameters`·`arguments` 는 stdlib `dict` 다. 벤더 SDK 타입은 어댑터 안에 가둔다.
- `ToolSpec.parameters` 는 JSON Schema **객체 리터럴**이지 우리 타입이 아니다 — 벤더마다 방언이 있어 어댑터가 마지막에 맞춘다.

### 4.3 closed-set 보증은 벤더가 아니라 우리 게이트가 한다

벤더 스키마는 "도구 이름이 목록 밖일 수 없다"를 **대체로** 지켜 준다. 그래도 `IntentGate` 를 없애지 않는다.

- INV-1 은 우리 불변식이다. 벤더 동작에 위임하면 모델·벤더를 바꾸는 순간 보증이 사라진다(NFR-6.3 벤더 중립).
- 반대 방향의 실측이 이미 있다 — 게이트 펜스 처리 결함 2건에서 **모델은 맞는 답을 냈는데 우리가 파싱에 실패**했다.
  모델이 틀린 이름을 내는 쪽도 같은 정도로 가정하는 편이 안전하다.

따라서 도구 호출의 이득은 **정확도가 아니라 파싱 실패율 감소**로만 계상하고, 승인 전에 실측한다(business-rules §3 DoD).

### 4.4 베낄 선례는 `EDIT_TRANSLATION` 이다

발화를 `(닫힌 연산, 평면 인자, 검증된 참조집합)` 으로 옮기는 경로가 **이미 작동 중이다.** 구조를 그대로 가져온다.

| `EDIT_TRANSLATION` 이 하는 것 | 인자 추출에서 대응되는 것 |
|---|---|
| 서버가 `$edit_ops` 로 닫힌 연산 집합을 프롬프트에 주입 | `tool_specs()` 가 13개 도구 이름·인자 스키마를 주입 |
| `params` 는 평면 dict | `IntentFrame.arguments` 평면 스칼라 |
| `affected_slots ⊆ current_slots` 를 게이트가 교차 검증 | `PLACE_REF`·`SLOT_REF` 를 현재 일정·후보 풀과 교차 (§7 INV-1) |
| 모델이 낸 `applyMode` 를 **버리고 코드가 재계산**(`resolve_apply_mode`) | 모델이 낸 라우팅·확인 판단을 버리고 `ROUTING_TABLE`·확인 규칙이 재계산 |
| 번역 불가면 `{"editCommand": null}` | 분류 불가면 `{"intent": null}` (`intent.yaml` 현행 그대로) |

`EditTranslationGate` 가 한 번 겪은 사고도 그대로 상속되는 위험이다 — **"고르는 행위"는 화이트리스트, "가리키는 행위"는 현재 상태**로
검증한다(anti-patterns 등재). `PLACE_REF` 가 새 장소를 고르는 자리면 후보 풀로, 기존 일정을 가리키는 자리면 현재 일정으로 본다.

---

## 5. 다중 의도 (④) — `RouterOutcome` + 기존 `ExecutionPlan`

정본이 이미 답을 적어 뒀다. `orchestrator-delegation-design.md:182`:

> 복합 intent(예: "일정 바꾸고 회고도 써줘")는 Execution Plan에서 step 1개에 EditAgent+ReflectAgent 병렬 배치 — 기존 규칙 그대로.

그리고 그 Execution Plan 타입이 **이미 코드에 있다**(`domain/execution.py` — `ExecutionPlan{steps}` / `ExecutionStep{agents, timeout_sec}`,
"step 내 병렬, step 간 순차"). 프로덕션 소비자가 0일 뿐이다. **새 실행 계획 타입을 만들지 않는다.**

역할을 둘로 가른다.

```
IntentFrame[]  =  사용자가 무엇을 요청했나   (라우터 산출)
ExecutionPlan  =  그것을 어떻게 돌리나       (Orchestrator 가 컴파일)
```

컴파일 규칙은 한 줄이다 — **`depends_on` 이 없는 프레임들은 한 step 에 모으고, 있는 프레임은 다음 step 으로 민다.**
`ExecutionStep.timeout_sec` 은 `AgentTask.spawn` 의 시한 차감과 같은 예산에서 나온다(BR-AF-03).

되묻기는 **두 종류**이고 섞으면 안 된다. 무엇이 비었느냐가 다르다.

```
ArgumentClarify (frozen):        # 의도는 알겠는데 **인자**가 빈다
  frame_index: int
  argument: str                    # 비어 있는 필수 인자 이름
  question: str
  options: tuple[str, ...] | None  # 보기(있으면 버튼) — 없으면 자유 입력

IntentChoice (frozen):
  intent: Intent                   # 반드시 후보 목록 안의 값
  label: str                       # 사용자에게 보일 한 줄 ("지금 일정을 버리고 새로 짠다")

IntentClarify (frozen):          # **의도** 자체가 안 갈린다
  question: str                    # LLM 생성 — 발화의 말을 되짚는 재확인 질문
  choices: tuple[IntentChoice, ...]  # 2~3개, 전부 서로 다른 Intent
  source: str                      # 근거가 된 발화 원문 (그대로)

RouterOutcome (frozen):
  frames: tuple[IntentFrame, ...]
  clarify: ArgumentClarify | IntentClarify | None   # None 이면 전부 실행 가능
  llm_calls: int                   # 계측
```

**한 칸에 둘을 담는 이유**: 동시에 나올 수 없다. 의도를 모르면 **어떤 인자가 필요한지도 모른다**
(`ARGUMENT_TABLE` 이 의도로 색인된다). 두 칸으로 두면 "둘 다 채워진" 표현 불가능한 상태가 타입에 생긴다.

`ArgumentClarify` 는 계약 정본이 이미 이름 붙여 둔 `EditAgentOutput.clarification_needed`(`agent-io-contracts.md:232`,
"엔티티 애매 → 사용자 확인 질문")의 일반화다 — 그쪽은 `str | None` 한 칸이라 **무엇을 묻는지**를 기계가 알 수 없다.
어느 인자를 채우려는 질문인지 알아야 다음 턴에 그 인자에 넣을 수 있다.

### 5.1 `IntentClarify` — 질문을 LLM 이 만든다 (팀 결정 2026-09-15)

되묻기 문안의 소유를 **AI 쪽으로 확정한다.** 고정 문구("일정을 새로 짤까요?")로는 부족하다 —
사용자가 **자기가 한 말**을 다시 보지 못하면 무엇을 고르는지 모른다. 실제로 갈리는 자리가 그렇다:

> "일정 다시 짜줘" → 지금 것을 버리고 새로 (`REGENERATE`) / 비가 와서 남은 것만 (`REPLAN`)

같은 문장이고 **차이는 문장 안에 없다.** 그래서 질문이 발화를 되짚어야 한다 —
"'다시 짜줘'가 지금 일정을 버리고 처음부터란 뜻인가요, 아니면 남은 일정만 조정하란 뜻인가요?"

생성 규약 (프롬프트 `intent_clarify.yaml`, 신규 `LlmFeature.INTENT_CLARIFY`):

| 입력 | 사용자 발화 원문 + **후보 의도 2~3종의 뜻** (서버 주입 — `$candidates`) |
|---|---|
| 출력 | 질문 1개 + 보기 2~3개, 보기마다 후보 의도 하나에 대응 |
| 금지 | 후보 **밖** 선택지 생성 · 되묻기 안에서 새 정보 요구(그건 `ArgumentClarify` 몫) · 시각·거리 언급(INV-2·3) |
| 게이트 | `IntentClarifyGate` — 모든 보기가 **주입된 후보 목록** 안의 `Intent` 로 되매핑되는지 검사. 실패하면 정적 폴백 문구 |

서버가 후보를 주입하고 게이트가 되매핑을 검사하는 구조는 `EDIT_TRANSLATION` 의 `$edit_ops` 와 같다 —
**전체 13종을 주지 않는다.** 라우터가 갈등하는 2~3개만 준다. 모델에게 라우팅을 다시 시키는 것이 아니라
**이미 좁혀진 둘 중 무엇인지 사용자에게 물을 문장**을 만들게 하는 것이다.

**post-init 불변식**

| 조건 | 강제 |
|---|---|
| `frames` | 1개 이상 · **2개 이하** (BR-DLG-10) |
| 상태 변경 의도 | `frames` 안에 **최대 1개** (BR-DLG-11) |
| `clarify` 가 `ArgumentClarify` | `frames[clarify.frame_index].missing` 에 `clarify.argument` 가 있다 |
| `clarify` 가 `IntentClarify` | `choices` 가 2~3개 ∧ 서로 다른 `Intent` ∧ 전부 `ROUTABLE_INTENTS` 안 ∧ `frames` 는 길이 1 (의도가 안 갈렸으니 분해도 못 한다) |
| `clarify = None` | 모든 프레임이 `executable` |
| `depends_on` | 가리키는 순번이 `frames` 범위 안 ∧ 자기보다 앞 |

`ArgumentClarify` 를 `MatchRoute` 의 새 값으로 만들지 **않는다** — `MatchRoute` 는 "의도를 어떻게 정했나"이고 그쪽 되묻기는 "인자가 비었나"다.
섞으면 "CONFIDENT 로 정해졌는데 인자가 빈" 흔한 경우를 표현할 수 없다.
반면 `IntentClarify` 는 **의도를 못 정한 상태**이므로 `MatchRoute.FALLBACK` 을 대체하는 자리에 온다 (business-logic-model §5.4).

---

## 6. 멀티턴 (⑤) — `DialogueContext`

**대화 상태의 저장 책임은 백엔드에 있다.** 대안 비교는 business-logic-model §4. AI 서비스는 무상태로 남고,
경계가 매 턴 이 값을 받고 갱신본을 돌려준다.

이 모양은 새것이 아니다 — **`CONFIRM_REQUIRED` 왕복이 이미 그렇게 돌아간다.** `EditAgent` 가 파괴적 편집에
`CONFIRM_REQUIRED` 를 돌려주면 서버는 아무것도 안 들고 있고, 클라이언트가 **요청 전체를 `confirm=true` 로 다시 보낸다**.
멀티턴은 그 왕복에 "무엇을 물었는지"를 얹은 것이다.

```
PendingFrame (frozen):
  frame: IntentFrame               # missing 이 비어 있지 않은 프레임
  asked: str                       # 직전에 사용자에게 물은 질문
  asked_argument: str              # 그 질문이 채우려던 인자
  asked_at: datetime               # tz-aware 강제 (serialization.py 규칙)

DialogueContext (frozen):
  pending: PendingFrame | None
  turn_index: int                  # ≥ 0, 백엔드가 증가시킨다
  clarify_count: int               # 이 보류 프레임에 대해 되물은 횟수 (상한 1 — BR-DLG-23)
```

- `to_dict`/`from_dict` 왕복 강제(U5-P10) — 봉투 타입과 같은 규약.
- **넘기는 것은 보류 프레임이지 대화 기록이 아니다.** 직전 발화 전문도, 턴 목록도 싣지 않는다
  (D31 참조 원칙 · 토큰 비용 · 개인 발화 최소 수집). 보관 정책 자체가 아직 열린 항목이다 —
  제품 정본이 O3 로 "**대화 이력 보관 정책**(운영 결정, 어시스턴트 후속 게이트)"을 미결로 걸어 뒀다.
  **그 결정 전에 AI 서비스가 발화를 들고 있으면 안 된다.**
- `clarify_count` 를 컨텍스트에 두는 이유: AI 서비스가 무상태라 "이미 물었는지"를 스스로 알 수 없다.
  상한을 지키려면 그 수를 **경계로 되돌려 받아야** 한다.

### 6.1 `NEED_MORE_INFO` 와 섞지 않는다

`AgentStatus.NEED_MORE_INFO` 의 `missing` 은 **Provider 데이터**를 가리킨다(테스트 픽스처가 `{"missing": ["weather"]}`),
해법은 "Orchestrator 가 수집해 재위임, 최대 1회"(BR-AF-05)이고 **사람 왕복이 없다.**
이쪽은 **사용자가 말하지 않은 것**이라 사람 왕복이 필수다. 한 코드로 합치면 "데이터가 없다"와 "사용자가 안 말했다"가
같은 재시도 정책을 타게 된다 — 별개로 둔다(BR-DLG-25).

---

## 7. 불변식 정합

| 불변식 | 이 FD 에서의 의미 |
|---|---|
| **INV-1** | 의도 라벨은 `Intent` enum(closed-set) — 도구 호출을 써도 `IntentGate` 가 정본(§4.3). **`PLACE_REF` 인자는 문자열일 뿐이고 POI id 해소는 LLM 이 아니라 현재 일정·후보 풀 대조로 한다** |
| **INV-2** | 인자에 담기는 시각은 **요청**이지 확정 시각이 아니다. "3시에 넣어줘"의 3시는 어셈블리 검증을 통과하기 전까지 사용자에게 보이는 값이 될 수 없다 |
| **INV-3** | `GET_DISTANCE` 인자에 소요시간 항목을 두지 않는다 — 거리만(라우팅 표가 이미 명시) |
| **INV-4** | 되묻기는 실패가 아니지만 **상한이 있다**(프레임당 1회). 초과·도구 미지원·프레임 부분 실패 전부 결정론 폴백으로 수렴하고 침묵하지 않는다 |
| **DL-3** | 프레임의 `intent` 를 Agent 가 재해석하지 않는다 — `source_span` 은 봉투의 `utterance` 와 같은 뉘앙스 참고 전용 |
| **DL-4** | 다중 프레임의 시한은 `spawn` 으로 나눈다 — 자식이 부모보다 오래 사는 봉투는 생성 불가(BR-AF-03) |
