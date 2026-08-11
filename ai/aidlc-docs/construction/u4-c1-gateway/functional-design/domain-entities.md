# U4 — C1 LLM Gateway: 도메인 엔티티 보강 (FD)

> 근거 정본: `ai-implementation-design.md` §3(C1 컴포넌트), `ai-prompt-design.md` §1(원칙)·§2.1(PreferenceScoring),
> AI-D06(Anthropic 직접·티어), `agent-structure-v2.md`(4겹 제한 장치), D31/G181(컨텍스트 최소·권한 재조회).

## 0. U1 재사용 — 변경 0

U4는 U1이 만든 규격을 **소비**한다. 아래 타입은 손대지 않는다.

| U1 타입 | U4에서의 역할 |
|---|---|
| `LlmPort` / `LlmRequest` / `LlmResponse` / `LlmTimeoutError` | 콘센트 — GatewayFacade가 유일한 호출자 |
| `TypedResult[T]` (is_fallback→value=None 강제) | 모든 게이트웨이 반환형 |
| `CandidatePool.contains()` | ClosedSetGate의 O(1) 화이트리스트 (INV-1) |
| `ScoredPoi` | PreferenceScoring 출력 원소 |
| `PromptRef` (버전 없는 호출 타입상 불가) | PromptRegistry가 생성 |
| `LlmCallRecord` / `GateDropEvent` / `FallbackEvent` | 계측 의무의 실체 (docstring에 "의무: U4"라 명시돼 있음) |

## 1. 신규 — `domain/llm.py` 보강

### LlmFeature (StrEnum) — 기능 목록 자체가 closed-set

"소형 LLM에게 허용된 기능 몇 개만" 원칙의 타입 강제. **이 enum 밖의 LLM 호출은 존재할 수 없다.**

| 값 | 티어 (AI-D06) | 구현 유닛 |
|---|---|---|
| `PREFERENCE_SCORING` | 경량 | **U4 (본 유닛)** |
| `INTENT` / `PARAPHRASE` / `REASON_INTERPRETATION` | 경량 | U5 |
| ~~`EXPLANATION` / `ALTERNATIVE_SELECTION` / `REFLECTION`~~ `EXPLANATION` / `REFLECTION` | 상위 | U5·U6 |
| `ALTERNATIVE_SELECTION` | 상위(HEAVY) | U5 (**PlanBAgent 전속** `llm.select_alternatives` — TRIP-331) |
| `REFLECTION_NUDGE` | 경량(LIGHT) | U6 (회고 유도 푸시 문구 — TRIP-347) |
| `PLACE_EXTRACTION` | 상위 (백그라운드) | U6 |
| `EDIT_TRANSLATION` | 경량(LIGHT) | agent-foundation 스텝 ⓪ (**EditAgent 전속**) |

> `EDIT_TRANSLATION` 역할: **확정된 EDIT_SCHEDULE 의도의 세부를 `EditCommand`로 번역**한다 —
> 라우팅 의도 재해석이 아니다 (DL-3·BR-AF-02·BR-AF-08). 정의 정본은 agent-foundation FD domain-entities §1이고,
> 본 표는 그 §1의 5종 세트 절차 step 1(u4 티어 표 반영)이다 — agent-foundation FD business-rules §4의 개정 항목
> "u4 …domain-entities.md §1"은 **본 행으로 반영 완료** (TRIP-315).
> 티어는 INTENT·PARAPHRASE와 동급 과업이라는 근거의 **제안값**이며, LIGHT 확정 여부는
> 복잡 편집 발화 정확도를 K-2 실모델 검증에서 확인한 뒤 확정한다 (**미결 #4**, agent-foundation FD business-rules §5).

> **개정 (2026-08-11, TRIP-349)**: 선구현 반영 — `ALTERNATIVE_SELECTION`을 상위 그룹 행에서 분리해
> 구현 소재(PlanBAgent 전속, TRIP-331)를 명시하고, `REFLECTION_NUDGE`(회고 유도 푸시 문구, TRIP-347) 행을 추가했다.
> 티어 매핑의 구현 정본은 `llm_gateway/config.py::default_tier_map`(경량 6·상위 4)이며 본 표와 일치한다.
> 프롬프트 스펙은 프롬프트 정본 §2.6(ALTERNATIVE_SELECTION)·§2.7(REFLECTION_NUDGE).

### ModelTier (StrEnum)

`LIGHT`(claude-haiku-4-5) / `HEAVY`(claude-sonnet-5) / `OFFLINE`(claude-opus-4-8, 배치·회귀 전용).
**model_id는 항상 설정값** (AI-D06) — enum은 티어만, 실체 문자열은 `C1Config`.

## 2. 신규 — `domain/persona.py`

PreferenceScoring 입력 컨텍스트 (프롬프트 정본 §2.1). KB-2 페르소나 전체가 아니라 **점수 산정에 필요한 최소 요약**만 (G181).

```
TasteTag (StrEnum, 7축 고정): NATURE·CITY·FOOD·CULTURE·SHOPPING·ACTIVITY·REST
CompanionType (StrEnum): SOLO·COUPLE·FAMILY·FRIENDS
PersonaSummary (frozen): taste_tags: tuple[TasteTag,...] · companion: CompanionType · budget: BudgetLevel(재사용)
  + to_dict/from_dict (U5-P10 왕복)
```

> 미결 #3(7축 택소노미)은 프롬프트 정본 §2.1의 7축을 그대로 채택해 해소. 온보딩 설계 변경 시 이 enum만 개정.

## 3. 신규 — `domain/context.py` (D31)

```
Principal (frozen): user_id: str                      # 요청자
ResourceRef (frozen): kind: str · ref_id: str · owner_id: str   # 재조회 대상 참조
PermissionDeniedError(Exception)                      # 권한 위반 — "조용한 제외 금지"
```

클라이언트가 넘긴 원본 데이터는 프롬프트에 넣지 않는다 — ResourceRef로 **요청자 권한 하에 재조회**한 값만 (D31). 위반 시 부분 성공 없이 즉시 예외.

## 4. 파서 출력 (c1 내부 — 도메인 아님) / 게이트 통과분의 도메인 승격

LLM raw JSON의 중간 표현 `RawScore(poi_id_str, score, reason)`는 `c1/gate.py` 내부 타입.
게이트 통과 후에만 `ScoredPoi`(도메인)로 승격 — **검증 전 데이터가 도메인 타입이 되는 것을 구조로 차단.**

이 승격 규칙의 소유는 본 §4다. 따라서 **게이트 통과분 타입의 규격도 본 FD가 소유**한다:

| 타입 | 실제 모듈 | 지위 |
|---|---|---|
| `EditTranslation` (`command: EditCommand` · `apply_mode: ApplyMode` + `to_dict`/`from_dict`) | `domain/edit.py` (U1 FD §5 Edit 인벤토리에 합류) | EDIT_TRANSLATION 게이트 **통과 후에만** 생성되는 도메인 타입. `apply_mode`는 LLM 제안이 아니라 `resolve_apply_mode`가 재계산한 값이고(AI-D02 하이브리드), 솔버 검증·실제 반영은 EditAgent(U5) 몫이라 이 타입은 **초안까지**다 (INV-2) |

- 배치 근거: 게이트 파일에 두면 "검증 전/후" 경계가 c1 내부 타입(`RawScore`)과 시각적으로 구분되지 않고,
  EditAgent(U5, agents 계층)가 소비할 때 `c1.gates` 모듈을 import해야 해 계층 규칙 L-3의 취지(하위 구현 세부 비노출)와 어긋난다.
- 소유 FD 근거: 값의 **의미와 불변식**(무엇이 통과분인가·apply_mode를 누가 정하는가)은 C1 게이트 규격이므로 u4 FD.
  agent-foundation FD §1은 `EDIT_TRANSLATION` **feature**(이름·티어·소유 에이전트)만 정의하고 출력 타입 규격은 정의하지 않는다.
