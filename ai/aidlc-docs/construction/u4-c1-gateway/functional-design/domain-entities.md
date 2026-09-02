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
| ~~`EXPLANATION` / `ALTERNATIVE_SELECTION` / `REFLECTION`~~ `EXPLANATION` | 상위 | U5 (`REFLECTION`은 2026-08-25 `REFLECTION_TEMPLATE`으로 흡수·제거 — TRIP-558) |
| `ALTERNATIVE_SELECTION` | 상위(HEAVY) | U5 (**PlanBAgent 전속** `llm.select_alternatives` — TRIP-331) |
| `REFLECTION_NUDGE` | 경량(LIGHT) | U6 (회고 유도 푸시 문구 — TRIP-347) |
| `REFLECTION_TEMPLATE` | 상위(HEAVY) | U6 (회고 연출 템플릿 — TRIP-429, U6 FD v1.0 Phase 1. **ReflectAgent 전속**, BR-AF-07 절차) |
| `REFLECTION_TEMPLATE_VISION` | 상위(HEAVY, **vision**) | U6 Phase 2 (사진 동봉 장면·캡션 생성 — TRIP-595. 텍스트판과 **같은 출력 계약·같은 게이트**, feature 분리는 모델 라우팅 때문(미결 #6 확정). 폴백: compose_vision이 3회 공유 예산(#9) 안에서 텍스트로 강등) |
| `PHOTO_HIGHLIGHT` `REFLECTION_TEMPLATE_VISION` | 상위(HEAVY, **vision**) | U6 Phase 2 (동의된 사진 → 대표 N장 — TRIP-595. 이미지 파트를 싣는 첫 feature. 산출은 `photo_id` 튜플뿐 — 시각 서술은 받지 않는다, BR-U6R-11. composer 통합 완료(compose_vision — 같은 브랜치 e46a7347). **API 배선만 후속**(TRIP-478 실사진 전달 시점)) |
| `PLACE_EXTRACTION` | 상위 (백그라운드) | U6 (**미배선** — 프로덕션 호출자 0, TRIP-529) |
| `EVENT_EXTRACTION` | 상위(HEAVY, 백그라운드) | TRIP-421 (웹 검색 스니펫 → 행사 구조화 추출. 행사는 POI가 아니라 후보 풀 비편입 — INV-1 비적용) |
| `EDIT_TRANSLATION` | 경량(LIGHT) | agent-foundation 스텝 ⓪ (**EditAgent 전속**) |

> `EDIT_TRANSLATION` 역할: **확정된 EDIT_SCHEDULE 의도의 세부를 `EditCommand`로 번역**한다 —
> 라우팅 의도 재해석이 아니다 (DL-3·BR-AF-02·BR-AF-08). 정의 정본은 agent-foundation FD domain-entities §1이고,
> 본 표는 그 §1의 5종 세트 절차 step 1(u4 티어 표 반영)이다 — agent-foundation FD business-rules §4의 개정 항목
> "u4 …domain-entities.md §1"은 **본 행으로 반영 완료** (TRIP-315).
> 티어는 INTENT·PARAPHRASE와 동급 과업이라는 근거의 **제안값**이며, LIGHT 확정 여부는
> 복잡 편집 발화 정확도를 K-2 실모델 검증에서 확인한 뒤 확정한다 (**미결 #4**, agent-foundation FD business-rules §5).

> **개정 (2026-08-11, TRIP-349)**: 선구현 반영 — `ALTERNATIVE_SELECTION`을 상위 그룹 행에서 분리해
> 구현 소재(PlanBAgent 전속, TRIP-331)를 명시하고, `REFLECTION_NUDGE`(회고 유도 푸시 문구, TRIP-347) 행을 추가했다.
> ~~티어 매핑의 구현 정본은 `llm_gateway/config.py::default_tier_map`(경량 6·상위 4)이며 본 표와 일치한다.~~
> 프롬프트 스펙은 프롬프트 정본 §2.6(ALTERNATIVE_SELECTION)·§2.7(REFLECTION_NUDGE).

> **개정 (2026-08-25, TRIP-530) — 표와 단언을 코드에 맞춤**: 직전 개정의 "경량 6·상위 4" 단언은 그 시점에도
> 자기 표와 어긋났고(표 기준 상위 5), 그 뒤 `EVENT_EXTRACTION`(TRIP-421)·`EDIT_TRANSLATION`(TRIP-315)이
> 늘어 더 벌어졌다. **실측 정본 (2026-08-25)**:
> - `domain/llm.py::LlmFeature` = **13종** (본 표와 일치, `EVENT_EXTRACTION` 행 추가로 해소)
> - `llm_gateway/config.py::default_tier_map` = **13종 전량 매핑, 경량 6 · 상위 7**
>   - 경량 6: `PREFERENCE_SCORING` `INTENT` `PARAPHRASE` `REASON_INTERPRETATION` `EDIT_TRANSLATION` `REFLECTION_NUDGE`
>   - 상위 7: `EXPLANATION` `ALTERNATIVE_SELECTION` `REFLECTION` `REFLECTION_TEMPLATE` `PLACE_EXTRACTION` `EVENT_EXTRACTION`
>
> 재현: `grep -c 'LlmFeature\.' src/trippilot/llm_gateway/config.py` 및 `domain/llm.py::LlmFeature` 본문 대조.
> **enum에 값을 늘릴 때 본 표·본 단언·`default_tier_map` 셋을 함께 고칠 것** — 이 셋이 어긋난 채로 두 번 흘렀다.

> **개정 (2026-08-28, TRIP-595) — 위 단언 갱신**: `PHOTO_HIGHLIGHT` 추가에 따라 **상위 7**의 목록이 바뀐다.
> 종전 목록의 `REFLECTION`은 2026-08-25(TRIP-558)에 이미 제거됐는데 위 단언에는 남아 있었다.
> - 경량 6: 무변
> - **상위 7: `EXPLANATION` `ALTERNATIVE_SELECTION` `REFLECTION_TEMPLATE` `PHOTO_HIGHLIGHT` `PLACE_EXTRACTION` `EVENT_EXTRACTION`**
>
> **합계(13종·경량 6·상위 7)는 종전과 같다** — `REFLECTION` 제거와 `PHOTO_HIGHLIGHT` 추가가 상쇄됐기 때문이다.
> 위 재현 명령은 개수만 세므로 **이번 표류를 잡지 못한다**(개수가 우연히 맞는다). 목록 대조가 필요하다:
> `grep -oE 'LlmFeature\.[A-Z_]+: ModelTier\.HEAVY' src/trippilot/llm_gateway/config.py`.

> **유령 feature 註 (2026-08-25, TRIP-530) — `REASON_INTERPRETATION` 은 호출 경로가 없다**:
> enum과 `default_tier_map`(경량)에는 있으나 **프롬프트 yaml·출구 게이트·워커가 셋 다 없다**
> (`prompts/` 에 `reason_interpretation.yaml` 부재, `gates/`·`workers/` 에 대응 모듈 부재).
> 즉 `LlmFeature.REASON_INTERPRETATION` 으로는 게이트웨이를 호출할 수단 자체가 없다.
> 반대 방향의 짝은 `CONVERSATION` 이다 — `services.md` §5·`component-methods.md`·`ai-implementation-design.md` §2가
> 전제하는 이 이름은 **코드에 존재하지 않는다**(enum 값 아님).
> **어느 이름이 맞는지는 본 개정이 판정하지 않는다** — 확실한 것은 둘 다 미완이고 **어느 쪽도 동작하지 않는다**는
> 사실뿐이다. 사유 해석 기능을 실제로 열 때 이름을 하나로 확정하고 5종 세트(enum·tier·프롬프트·게이트·워커)를 채울 것.

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
| `EditTranslation` (`command: EditCommand` · `apply_mode: ApplyMode` + `to_dict`/`from_dict`) | `domain/edit.py` (U1 FD §5 Edit 인벤토리에 합류) | EDIT_TRANSLATION 게이트 **통과 후에만** 생성되는 도메인 타입. `apply_mode`는 LLM 제안이 아니라 `resolve_apply_mode`가 재계산한 값이고(AI-D02 하이브리드), 어셈블리 검증·실제 반영은 EditAgent(U5) 몫이라 이 타입은 **초안까지**다 (INV-2) |

- 배치 근거: 게이트 파일에 두면 "검증 전/후" 경계가 c1 내부 타입(`RawScore`)과 시각적으로 구분되지 않고,
  EditAgent(U5, agents 계층)가 소비할 때 `c1.gates` 모듈을 import해야 해 계층 규칙 L-3의 취지(하위 구현 세부 비노출)와 어긋난다.
- 소유 FD 근거: 값의 **의미와 불변식**(무엇이 통과분인가·apply_mode를 누가 정하는가)은 C1 게이트 규격이므로 u4 FD.
  agent-foundation FD §1은 `EDIT_TRANSLATION` **feature**(이름·티어·소유 에이전트)만 정의하고 출력 타입 규격은 정의하지 않는다.
