# Implementation Plan: 도우미 오케스트레이터 (assistant-orchestrator)

**Branch**: `feat/assistant-orchestrator` | **Date**: 2026-10-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-assistant-orchestrator/spec.md`

**설계 정본(재서술하지 않는다)**: `ai/aidlc-docs/construction/assistant-orchestrator/functional-design/{domain-entities,business-logic-model,business-rules}.md`. 이 plan 은 그 FD 의 어느 절이 어떤 코드 자리에 떨어지는지만 적는다.

## Summary

도우미 턴을 AI 쪽 `DialogueOrchestrator` 가 처리한다: LLM 직접 의도 분류(새 feature `DIALOGUE_INTENT`, 기존 `IntentGate` 재사용) → 의도별 핸들러가 Provider·PlanBAgent·POI 배치 조회를 공유 스레드풀에 동시에 던져 시한 안에 온 것만 모음 → LLM 답변 조합(`DIALOGUE_ANSWER`, 출구 게이트 + 결정론 템플릿 폴백) → 10턴마다 20줄 요약(`DIALOGUE_MEMORY`)을 AI DB `ai_kb.dialogue_memory` 에 저장. 기존 3단 `IntentRouter` 는 섀도 전용 조립으로 백그라운드에서 돌려 `intent_shadow` 로그 1줄만 남긴다. 경계는 `/ai/v1/dialogue/interpret` 를 확장(outcome `ANSWER` + `answer`, 요청 `session_id`·`account_ref`·`recent_turns`)하고 메모리 파기·내보내기 경계 2개를 더한다. 백엔드는 같은 PR 에서 ANSWER 분기·요청 필드·시한 9s·일 상한 100·파기 호출을 받는다. FE 변경 0. EDIT_SCHEDULE 은 1단계에서 FRAME 으로 기존 백엔드 제안 경로를 탄다(FD BLM 2단계 절).

## Technical Context

**Language/Version**: Python ≥3.11 (AI, `ai/`), Kotlin + Spring Boot 4 (BE `backend/modules/assistant`), Helm/Python 배포 도구(`deploy/eks`)

**Primary Dependencies**: FastAPI · pydantic 2 · psycopg 3(`psycopg[binary]`, 풀 없음) · 기존 `llm_gateway`(GatewayFacade·PromptRegistry·게이트) · 기존 `IntentRouter`·`PlanBAgent`·`CandidatePoolBuilder`·Provider 5종 · BE RestClient + Jackson 3

**Storage**: AI `ai_kb`(RDS 내 Postgres, 역할 `ai_user`) 새 테이블 `dialogue_memory` — DDL 은 `deploy/eks/bootstrap.sql` + `ai/docker/vector-init/02-dialogue-memory.sql` 두 정본(어댑터는 DML 만). BE 는 스키마 변경 없음(`assistant_session.dialogue_context` 모양 불변).

**Testing**: pytest + hypothesis(PBT 게이트 = FD BR §2 표), `tests/fakes` 재사용 + feature 분기 FakeLlm 신설, 기존 재생 픽스처 `tests/fixtures/intent_gate` **무변경**; BE Kotest(`:modules:assistant:test` + app IT); 차트 `deploy/eks/chart/tests`·`deploy/eks/tests`

**Target Platform**: EKS(uvicorn --workers 2 × 파드 1~4 — 프로세스 로컬 상태 금지), 로컬 docker-compose

**Project Type**: web-service(AI) + 모노레포 동반 변경(BE·deploy·docs)

**Performance Goals**: BE 해석 단계 9,000ms 안 응답(분류 ≤2.5s · 팬아웃 ≤3s · 답변 ≤2.5s · 요약은 잔여 ≥2.5s 일 때만), 턴 전체 13s, 앱 15s. 섀도는 응답 경로 밖.

**Constraints**: INV-1~4 · DL-5(경계 예외 금지) · L-규칙(agents ↛ orchestrator/providers/LlmPort) · `wiring.py` 최소 줄 · yaml 은 `main.py` 로드 · CI 실 외부 호출 0 · 응답 키 집합 BE 정확 일치 게이트(한 PR) · 발화 원문 로그 금지 · 모델 문자열 하드코딩 금지

**Scale/Scope**: 의도 13종 + 범위 밖, 신규 LLM feature 3, 신규 Provider 1, 새 경계 2, BE 변경 파일 ≈8, 배포 파일 ≈6

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**I. 4대 불변식**
- INV-1: 의도 라벨은 `IntentGate` closed-set(새 feature 도 같은 게이트). 대안 후보는 `CandidatePoolBuilder` 풀 안에서만, 일정 안 POI 제외. 답변 문장이 장소를 지어 말할 위험은 facts 가 닫힌 집합인 것으로 제한(수용된 blast radius — 메모리 노트 prompt-injection-blast-radius). ✅
- INV-2: 시각·순서는 스냅샷(저장·검증값)과 어셈블리 값만 인용. 오케스트레이터는 시각을 계산하지 않는다. ✅
- INV-3: 와이어에 duration 류 필드 없음(계약 테스트가 토큰 검사). 답변·요약 게이트가 소요시간 표현 정규식을 거부. ✅
- INV-4: 분류 실패→OUT_OF_SCOPE, 답변 게이트 실패/시한 부족→결정론 템플릿, 요약 실패→결정론 압축, Provider 실패→PARTIAL, 메모리 DSN 부재→기동 WARN. 전부 FallbackEvent/로그 동반. ✅

**III. TDD + PBT**
- 테스트 먼저(red→green). PBT 게이트 = FD business-rules §2(AO-P1…): next_actions ≥1 ∧ TYPES · 문장 금칙 패턴 0 · llm_calls 에 섀도 미포함 · 요약 상한·멱등 · 시한 안 응답 · 핸들러 결정론 · `{"intent": null}`→OUT_OF_SCOPE · EDIT→FRAME · 섀도 로그 원문 부재. ✅
- 실 외부 호출 0: FakeLlm(feature 분기)·FakeEmbedding·InMemoryDialogueMemoryStore·FakeClock. ✅
- 완료 주장 전 `cd ai && uv run pytest -q` 전체 green 확인. ✅

**V. 아키텍처 경계**
- 새 코드는 새 파일(`orchestrator/dialogue_*.py`, `providers/poi_info.py`, `agents/adapters/*memory_store.py`, `llm_gateway/{workers,gates}/dialogue_*.py`, `prompts/dialogue_*.yaml`). `wiring.py` 는 생성자 인자·조립·위임 줄만. ✅
- orchestrator → agents·providers·poi_curation import 는 허용 선례(schedule_coordinator). agents 는 건드리지 않는다. ✅
- psycopg 는 `agents/adapters/` 안에서만, yaml 은 `llm_gateway/prompts.py`(프롬프트)·`main.py`(데이터). ✅
- 모델 배정은 `TRIPPILOT_LLM_FEATURE_MODELS` 항목 추가(코드에 모델 문자열 없음). ✅

위반 없음 → Complexity Tracking 비움.

## Project Structure

### Documentation (this feature)

```text
ai/aidlc-docs/construction/assistant-orchestrator/functional-design/
├── domain-entities.md        # 타입·와이어·DDL·섀도 기록 필드 (정본)
├── business-logic-model.md   # 결정 DEC-AO-*, 턴 파이프라인, 시한표, 의도별 처리표, BE·배포 변경
└── business-rules.md         # BR-AO-*, PBT 게이트 AO-P*, DoD, §4 정본 개정 목록, §5 미결
ai/specs/001-assistant-orchestrator/
├── spec.md                   # 요구사항·시나리오 (이 plan 의 입력)
├── plan.md                   # 이 파일
├── checklists/requirements.md
└── tasks.md                  # /speckit-tasks 산출
```

### Source Code (repository root)

```text
ai/src/trippilot/
├── orchestrator/
│   ├── dialogue_orchestrator.py   # DialogueOrchestrator.turn() — FD BLM 파이프라인 0~7
│   ├── dialogue_handlers.py       # 의도별 Handler 표·슬롯 해소·facts 조립(순수) — FD BLM 처리표
│   ├── dialogue_memory.py         # DialogueMemory·due·compress_fallback — FD DE 메모리 절
│   ├── shadow_probe.py            # ShadowIntentProbe — FD BLM 섀도 절
│   └── dialogue_interpreter.py    # (기존) 되묻기 답 읽기·CountingLlm 재사용, 변경 최소
├── ports/memory_store_port.py     # MemoryStorePort Protocol
├── agents/adapters/
│   ├── pg_memory_store.py         # PgDialogueMemoryStore(connect) — DML 만
│   └── memory_memory_store.py     # InMemoryDialogueMemoryStore(테스트·DSN 없음)
├── providers/poi_info.py          # PoiInfoProvider(LLM 0회) + info_collector ProviderKind/행 추가
├── llm_gateway/
│   ├── workers/dialogue_intent.py · dialogue_answer.py · dialogue_memory.py
│   ├── gates/dialogue_answer.py · dialogue_memory.py   # 의도 게이트는 기존 gates/intent.py 재사용
│   └── config.py                  # tier_map·fallback_modes·effort 3항목
├── domain/llm.py                  # LlmFeature 3종 추가
├── api/
│   ├── schemas.py                 # 요청·응답 필드, 메모리 경계 스키마
│   ├── dialogue.py                # 사영(TurnInput↔요청, TurnOutcome↔응답, 메모리 경계 핸들러) + 오케스트레이터 조립 팩토리
│   ├── routes.py                  # DELETE/GET /ai/v1/dialogue/memory
│   └── wiring.py                  # 조립·위임 줄만(경합 1위)
ai/prompts/dialogue_intent.yaml · dialogue_answer.yaml · dialogue_memory.yaml
ai/main.py                         # env 2종·메모리 스토어 조립·WARN
ai/scripts/mlops/intent_shadow_report.py
ai/docs/openapi.json               # scripts/export_openapi.py 재생성
ai/tests/orchestrator/test_dialogue_orchestrator*.py · tests/llm_gateway/test_dialogue_*.py · tests/api/… (경로 집합·배선 게이트 갱신)

backend/modules/assistant/src/main/kotlin/com/trippilot/assistant/
├── domain/Dialogue.kt                          # InterpretOutcome.ANSWER · Interpretation.answer · InterpretRequest 필드
├── adapter/out/interpret/HttpDialogueInterpreter.kt   # Wire 필드·검증·read timeout require · 메모리 경계 호출
├── adapter/out/interpret/FakeDialogueInterpreter.kt   # ANSWER 대역
├── application/AssistantTurnService.kt         # answer() ANSWER 분기 · recent_turns · 서버 발급 quick reply
├── application/AssistantSessionService.kt · AssistantRetention.kt · AssistantExportContributor.kt  # 파기·내보내기 연동
├── application/AssistantProperties.kt + backend/app/src/main/resources/application.yml  # 9000 · 100
└── (tests) HttpDialogueInterpreterTest · AssistantTurnServiceTest · IT

deploy/eks/bootstrap.sql · ai/docker/vector-init/02-dialogue-memory.sql · deploy/eks/runtime_secrets.py
deploy/eks/chart/templates/ai.yaml · deploy/eks/chart/tests/test_chart.py · deploy/eks/tests/test_runtime.py
.env.example · docker-compose.yml · .github/workflows/aws-dev-logs.yml(namespace 입력)
```

**Structure Decision**: AI 단일 서비스 안의 새 모듈 + 모노레포 동반 변경(BE·deploy·docs). 전부 한 PR — 응답 키 집합 BE 게이트와 요청 extra=forbid 때문에 따로 머지할 수 없다. FE 는 손대지 않는다(기존 kind·NextAction·quick reply 규칙 안에서만 응답).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

(없음)
