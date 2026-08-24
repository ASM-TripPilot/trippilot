# U6 Reflect — 비즈니스 로직 모델 (FD)

> **v1.0 확정 (2026-08-25, 사용자 승인)** · 방침: **FE 합의 비차단** — 정본 계약(#334)대로 선행 구현하고 FE 의견은 통합 시점에 반영한다(팀 결정 2026-08-25) — TRIP-538.
> 설계 축: **"LLM은 장면 구성만, 결합은 서비스"** (계약 §2 — 본 FD는 이 계약을 변경하지 않는다).
> Phase 1(템플릿 회고)과 Phase 2(멀티모달 확장)는 **같은 출력 계약을 공유**하고, Phase 2는 장면 채움의 **입력만** 확장한다 —
> FE 재협상 없는 드롭인이 설계 목표이자 폴백 강등(INV-4)이 성립하는 근거다.

---

## 1. 모듈 배치

```
src/trippilot/
  domain/
    reflection.py            신규 값 타입 전부 (domain-entities §1~4) — 외부 의존 0
  agents/reflect/            agent-foundation §1의 예약 자리 실체화 (L-1~L-3 적용)
    agent.py                 ReflectAgent — 봉투 handle(AgentTask) + compose 코어 (두 진입이 같은 코어)
    composer.py              후보 생성 루프(≤3)·결정론 랭킹·장면/필드 폴백 교체 (계약 §4)
    fallback.py              고정 폴백 템플릿 빌더 — 자리표시자·STATS·MAP 장면만 (계약 §4.3)
    highlight_rule.py        [P2] 메타 기반 결정론 하이라이트 폴백 (LLM 0회)
  llm_gateway/
    gates/reflection_template.py    파서 + 검증 가능 항목 → TemplateCandidate(위반 목록 동봉)
    workers/reflection_template.py  1회 호출 조립 (vars → gateway.call) — reflection_nudge 워커와 같은 형
    workers/photo_highlight.py      [P2] 대표 사진 선별 워커
    gates/photo_highlight.py        [P2] photo_id ⊆ 입력 집합 게이트
  api/                       POST /ai/v1/reflection/generate (경계 3종 → 4종째, 계약 §5)
prompts/
  reflection_template.yaml   v0.1.0 (BR-AF-07 5종 세트의 일부)
  photo_highlight.yaml       [P2]
  reflection_template_vision.yaml  [P2 — 별도 feature 채택 시, 미결 #6]
```

의존 방향: `agents/reflect → llm_gateway(워커)·domain` — c1 ↛ c2·m7(BR-U4-09)·agents 형제 상호 import 금지(L-2)·
LlmPort 직접 import 금지(L-3) 전부 기존 아키텍처 테스트가 자동 커버. yaml은 prompts 한정, SDK는 adapters 한정 — 무변.

## 2. 경계·트리거 (계약 §5 그대로)

- **`POST /ai/v1/reflection/generate`**: 요청 = `ReflectionRequest`(백엔드가 방문 기록·이벤트·페르소나 요약을 조립 — AI stateless,
  generate와 동형), 응답 = `ReflectionTemplate.to_dict()`. 와이어 정본은 `ai/docs/openapi.json`에 반영(DoD).
- 트리거(일자 경계·TripCompleted)·상태 머신(PENDING→GENERATING→DRAFT→…)은 정본 `reflect-agent-design.md` §4·5 **무변** —
  발생·저장·상태 전이는 백엔드 소유, AI는 무상태 생성만.
- **시간 예산: 수치 미확정** — deadline 미지정(TRIP-473 임시 해제 상태). N회 생성 비용은 백그라운드 작업 전제로만 허용하며,
  시간제약 재도입(2026-10 예정) 시 deadline 값·체인 스킵 조건은 **후속 결정** (BR-U6R-14).
- 대화형 REFLECT intent(라우팅 테이블 — 수집 항목 없음) 경로는 AgentTask 봉투로 같은 compose 코어에 수렴 (BR-AF-01~05).

## 3. Phase 1 파이프라인 — compose(request, trace_id, now)

```
① 입력 검증        visits ≥ 1 (post-init) — 0건은 진입 불가 (BR-U6R-15)
② vars 조립        방문(명칭·카테고리·일자·순서·사진 수)·이벤트·페르소나·날씨·기간·지역
                   — 시각·체류분 미주입 (INV-3 원천 차단) · 숫자 통계 미주입 (자리표시자 강제)
③ 생성 루프 ≤ 3    gateway.call(REFLECTION_TEMPLATE, vars) → GateOutcome(value=TemplateCandidate)
                   · 게이트: JSON 파싱 → 스키마 강제 → 검증 가능 항목 판정 → 위반 목록 동봉
                     (파싱 실패만 그 시도의 실패 — 위반이 있어도 후보는 유지, 계약 §4 "드롭이 아니라 최선 채택")
                   · visit_ref 위반 poi_id는 GateDropEvent로 계측 (INV-1 사영 지표)
                   · 위반 0이면 조기 종료
④ 결정론 랭킹      (하드 수 ↑낮게, 소프트 수 ↑낮게, 장면 채움 ↑많게, 생성 차수 ↑이르게) 사전식 (계약 §4.2)
                   — LLM 심판(best-of-N judge) 금지 (1차)
⑤ 장면/필드 교체   최선 후보의 잔존 하드 위반만 §4 교체 맵으로 결정론 교체 — 전체 드롭 없음 (계약 §4.1)
⑥ 봉투 조립        ReflectionTemplate(is_fallback=False) — 3회 전부 파싱 실패 시 fallback.py 고정 템플릿
                   (is_fallback=True) + FallbackEvent (INV-4 — 서버 숫자는 항상 참이므로 폴백도 거짓 없는 결과물)
⑦ 관측             시도별 LlmCallRecord(성공·실패 불문, BR-U4-03) · 드롭·폴백 이벤트 — 전부 동일 trace_id
```

- ③의 워커·게이트는 U4 7단계 파이프라인을 그대로 탄다 — GatewayFacade 변경 0.
- ④⑤⑥은 순수 함수(입력 후보 집합 → 동일 출력) — wall-clock 직접 호출 금지, `now` 주입 (U3 pool_builder와 동일 규율).

## 4. 하드 위반 교체 맵 (⑤ — 결정론, 계약 §4.1 "그 장면/필드만 폴백")

| ViolationCode | 교체 동작 |
|---|---|
| `TIME_EXPR` (캡션·부제·해시태그 내 시간 표현) | 해당 캡션을 layout별 고정 안전 문구로 교체 (FALLBACK_NUDGE_MESSAGE 선례 — 고정 문구 스스로 금칙 0을 테스트가 고정) |
| `PLACEHOLDER_OUT` (어휘 밖·인덱스 범위 밖) | 해당 토큰만 제거, 문장 잔여가 공백이면 고정 문구로 교체 |
| `VISIT_REF_OUT` (방문 기록 밖 참조) | 그 장면의 photo_slot 제거, PHOTO_* layout이면 장면 생략 (no-photo 변형 선례 — j06) |
| `EVENT_NOT_FOUND` (source_event 미실재) | EVENT 장면 생략 |
| `HASHTAG_OUT` (허용 집합 밖) | 그 태그만 제거 (허용 집합 실체는 미결 #5) |

소프트 위반(`CAPTION_LEN`·`SCENE_COUNT`·`DUP_VISIT_REF`)은 교체하지 않는다 — 랭킹 감점만 (계약 §4.1).

## 5. 사진 결합(바인딩) 규칙 — 서비스 소유, LLM 0회

계약 §2: 사진은 사용자 업로드분을 **서비스가 슬롯에 바인딩**한다. 실행 소유는 백엔드 렌더 준비 단계(사진 정본·업로드 API가
백엔드 소유 — TRIP-478)이고, 본 FD는 **양측이 합의할 결정론 규칙만** 명세한다:

```
장면의 photo_slot.visit_ref에 대해
  ① visit_ref(일자·poi) 메타 일치 사진 → ② 방문 시간 창 내 taken_at → ③ GPS 근접(반경 초기값 제안 200m)
  → 대표 1장 tie-break: taken_at 오름차순 → photo_id 오름차순 (결정론)
  → 0장이면 장면 생략 또는 no-photo 변형 (계약 §3.2)
[P2] 하이라이트 목록에 있는 사진을 ①~③보다 우선 (미결 #1의 경계 전달 형태 확정 후)
```

## 6. Phase 2 파이프라인 — 입력만 확장, 출력 계약 불변

```
request.vision 없음(미동의·사진 0)  → Phase 1 경로 그대로 (강등 아님 — 기본 경로)
request.vision 있음 (VisionInput = 동의 증빙 없이는 타입상 생성 불가):
  ⓐ PHOTO_HIGHLIGHT 호출     사진 → 대표 N장 (출력 photo_id ⊆ 입력 집합 — 게이트 강제)
                              실패 → highlight_rule.py 메타 규칙 폴백(방문당 1장·시간 분산, 결정론) + FallbackEvent
  ⓑ 장면·캡션 생성            REFLECTION_TEMPLATE_VISION(이미지 파트 동봉, 미결 #6) — 시도 예산은 총 3회 공유(미결 #9)
                              실패(타임아웃·비지원 어댑터·파싱 실패) → REFLECTION_TEMPLATE(텍스트, Phase 1 ③)로 강등
                              + FallbackEvent(stage="vision", from="vision", to="meta_only") — 침묵 금지 (BR-U6R-10)
  ⓒ 이후 랭킹·교체·조립·관측  Phase 1 ④~⑦ 과 동일 — 출력 스키마 동일 (드롭인)
```

**계약이 불변인 이유**: 하이라이트 선별은 "어느 visit_ref/사진이 photo_slot에 우선되는가"를, vision 캡션은 "caption 내용"을
바꿀 뿐 — 둘 다 기존 필드의 **값**이지 새 필드가 아니다. 따라서 Phase 2의 어떤 실패도 Phase 1 결과로 강등해도 스키마가 같다.

### 6.1 LlmPort 확장 seam — LlmRequest 이미지 파트 (제안 2안, 기존 텍스트 호출 전부 무영향이 조건)

| | A안 — `LlmRequest`에 기본값 빈 튜플 필드 추가 (추천) | B안 — `LlmVisionRequest` + `invoke_vision()` 분리 |
|---|---|---|
| 형태 | `images: tuple[LlmImagePart,...] = ()` (`LlmImagePart = media_type + data_ref`) 후미 기본값 필드 | 별도 요청 타입·별도 메서드 |
| 기존 호출 영향 | **0** — 전 호출부가 키워드 인자, 후미 기본값이라 생성·직렬화 무영향 (기존 전 스위트 회귀가 게이트) | 0이지만 Port 표면 2배 — fake·어댑터 전부 이중 구현 |
| 비지원 어댑터 | `images ≠ ()` 수신 시 `LlmUnsupportedError` — 게이트웨이 실패 경로로 수렴(BR-U4-02 동형), **조용한 이미지 무시 금지** | 메서드 부재로 컴파일 타임 차단 — 대신 폴백 배선을 호출측이 이중으로 |
| ports 순수성 | stdlib만 유지 (data_ref는 str/bytes — SDK 타입 미노출) | 동일 |
| 판단 | 폴백 강등이 "같은 파이프라인, images만 비움"으로 표현돼 INV-4 계단이 단순 | 강등이 경로 전환이라 계단이 복잡 |

- 티어 라우팅: vision 지원 모델은 feature 단위로 갈리므로 **별도 feature(`REFLECTION_TEMPLATE_VISION`) 분리안을 추천**
  (TierRouter는 feature→model_id 결정론 — 같은 feature로는 모델을 나눌 수 없음. `feature_models` 오버라이드(TRIP-513) 활용).
  동일 feature 조건부안과의 확정은 실모델 검증 후 (미결 #6).
- 신규 feature 추가(`REFLECTION_TEMPLATE`·`REFLECTION_TEMPLATE_VISION`·`PHOTO_HIGHLIGHT`)는 **BR-AF-07 5종 세트**
  (FD 개정 + tier_map + prompts yaml + ROUTE-P1 + audit) — 티어·모델 실체는 C1Config 설정값, 프로바이더·모델 선정은
  TRIP-515 런북 소관 (본 FD는 확정하지 않는다).

### 6.2 시각 환각 불신 — 게이트 판정 범위 (BR-U6R-11)

실측(2026-08-25): 멘토 게이트웨이 responses 표면이 `input_image`를 라우팅함(HTTP 200 확인), 단 **1×1 투명 PNG에
"64×17 연초록"이라고 환각**. 즉 이미지가 전달돼도 시각 서술의 사실성은 신뢰 불가.

→ 게이트는 **검증 가능한 것만** 강제한다: 사진 참조 id ⊆ 입력 집합(closed-set 정신) · 스키마 · 길이 · 금칙어(INV-3).
시각 서술의 사실성 게이트는 두지 않는다 — 캡션은 사용자가 수정 가능한 초안(저위험)으로 분류하고, 오류 정정은
편집 UX와 운영 후 계약 미결 #3(장소명 검증 게이트) 경로에 맡긴다.

## 7. 테스트 전략 (전부 fake — 실 API·실 이미지 호출 CI 0건, D37)

| 대상 | 도구 |
|---|---|
| 오염 출력 → 교체·계측 (RFL-P1~P3) | 오염 주입 generator — visit_ref 밖 참조·시간 표현·어휘 밖 토큰을 FakeLlm 응답에 합성 |
| 랭킹·교체 결정론 (RFL-P4·P7) | 후보 집합 무작위 생성 → 순수 함수 이중 호출 동일성 단언 |
| 3회 실패 → 고정 폴백 (RFL-P5) | FailingLlm·쓰레기 텍스트 — InMemoryTrace로 FallbackEvent 단언 |
| 동의 게이트 (VIS-P1) | **VisionSpyLlm**(신규 fake) — 수신 LlmRequest.images를 기록, "미동의 조합에서 항상 빈 튜플" 단언 |
| 비지원 어댑터 강등 (VIS-P4) | 텍스트 전용 FakeLlm에 images 실린 요청 → LlmUnsupportedError → 폴백 신호 수렴 |
| 드롭인 스키마 동일 (VIS-P3) | vision 실패 스윕 → 응답 to_dict 키 집합 = Phase 1 결과 키 집합 |
| 직렬화 왕복 (RFL-P6) | 신규 generator `reflection_requests()`·`reflection_templates()` — U5-P10 패턴 재사용 |
