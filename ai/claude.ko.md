# TripPilot AI — 프로젝트 루트

> English version: ./claude.md

## 프로젝트 개요

TripPilot AI는 LLM + 최적화 어셈블리 하이브리드 아키텍처로 여행 일정을 생성·재계획·회고하는 **독립 Python AI 서비스**입니다.

## 핵심 구조

- `aidlc-docs/` — AI-DLC 워크플로우 산출물 (설계·요구사항·계획)
- `.kiro/` — Kiro IDE steering + AI-DLC 규칙 상세
- `README.md` — 전체 설계 개요 (최신 정보의 기준)

## 4대 불변식

1. **INV-1**: LLM은 closed-set 후보 안에서만 선택 (환각 0)
2. **INV-2**: 사용자에게 보이는 시각·순서는 어셈블리 검증값만
3. **INV-3**: 소요시간 미표시 — 거리만
4. **INV-4**: AI 실패 시 결정론 폴백 (침묵 실패 금지)

## 멀티에이전트 구조

> **정본은 `agent-structure-v2.md`** (TRIP-530, 2026-08-25). 아래의 2계층
> "agent-as-tool" 모델은 `agent-hierarchy-design.md`(v1) 서술인데 **v2가 대체**했다 —
> 정보원은 깊이 2로 호출되는 하위 에이전트가 아니라 `InfoCollector`가 모으는
> **Provider**이고, 결과는 봉투로만 전달된다(도구 겹침 0).

**업무 계층** (agent-redesign.md):
- **Orchestrator**: 의도 파악(하이브리드 질문뱅크 매칭) + Fast Path + AgentTask 봉투로 병렬 디스패치
- **ScheduleAgent**: 일정 생성 (Generation 패턴)
- **PlanBAgent**: 변수 대응 (RAG 패턴, KB 3종 + pgvector)
- **ReflectAgent**: 회고 생성 (1차: 단순 LLM Generation. 추후 Multi-step 확장)
- **EditAgent**: 일정 편집 (의도 해석 → 어셈블리 검증 → 반영)

**정보원** (v2 — `orchestrator/info_collector.py` + `providers/`):
Place · Weather · Transit · Persona · Event Provider. Orchestrator가
INFO_REQUIREMENTS 표에 따라 모아 **AgentTask 봉투에 실어** 넘긴다 — 업무 에이전트가
Provider를 직접 부르지 않는다. 각 Provider는 `ProviderStatus`
(`OK`/`LOW`/`NO_CANDIDATES`/`WEATHER_UNKNOWN`/`COLD_START`/`UNAVAILABLE`)를 함께 낸다.

⚠️ `IntentRouter`(질문뱅크 매칭)는 **구현돼 있으나 미배선** — 위 Orchestrator의 의도
파악은 설계이지 도는 코드가 아니다 (TRIP-529).

## 핵심 설계 문서 (application-design/)

- 위임 프로토콜: `orchestrator-delegation-design.md` (AgentTask/AgentResult, deadline 상속, trace_id)
- 입출력 계약: `agent-io-contracts.md` (FE↔BE↔Agent 대응)
- 의도 파악: `intent-matching-design.md` / 평가 지표(최신성·신속도): `evaluation-metrics-design.md`
- MLOps/LLMOps + ML 유형화: `mlops-llmops-design.md`

## Assembly 하이브리드 전략

OR-Tools (1차 결정론) → LLM (2차 창의적 제안) → 규칙 폴백 (최후 보장)
모든 출력은 HC1~HC4 검증 통과 필수.

⚠️ **LLM 2차 단계는 미배선이다** (TRIP-529, 2026-08-25). `api/wiring.py`가
`stages = (OrToolsAssembler, RuleFallbackAssembler)`로 조립한다 — 어셈블리 프롬프트 정본과 모델
설정이 아직 없기 때문이다. 따라서 AI-D07의 "잔여 ≥ 2.5s면 2차 실행" 분기는 **어떤
경로에서도 발생할 수 없다**.

## 기술 스택

- Python 3.11+ / Anthropic API 직접 (Claude — AI-D06) / OR-Tools / FastAPI
- pgvector + **로컬 `nlpai-lab/KURE-v1` 임베딩** (AI-D06 부기 2026-08-23, TRIP-514
  배선 완료). Titan은 폴백 어댑터이고 Bedrock 전용이다.
- pytest + Hypothesis — 속성 개수는 문서에 박지 않는다(늘 때마다 스테일이 된다, TRIP-530).
  세려면 `grep -rc "@given" ai/tests/*.py`. 종전 "19"·"52"·"170개/41개" 표기는
  모두 스테일이었다.
- LangChain: **선언만 있고 쓰지 않는다** — `pyproject.toml`에 의존성이 없고 `src/`에
  import 0건. RAG는 psycopg + pgvector로 직접 구현했다 (철회 기록은 TRIP-522).

## 현재 상태

**U1~U6 구축·가동 중** (2026-08-25 기준). FastAPI 경계가 열려 있고 백엔드가 실제로
왕복 호출한다: `POST /ai/v1/itinerary/{generate,validate,repair,alternatives,
explanations,edit}` + `/health` + `POST /ai/v1/reflection/{generate,nudge}`.
CI(`ai-ci`)가 "실행 앱 스키마 == 커밋된 `docs/openapi.json`"을 강제하고 외부 API는
전부 fake다(실호출 0). develop 푸시에서 GHCR 이미지가 발행된다.

**와이어 정본은 `docs/openapi.json`** — 손으로 고치지 말고 `scripts/export_openapi.py`로
재생성한다.

## AI-DLC 규칙

`.kiro/aws-aidlc-rule-details/`에 상세 규칙.
`aidlc-docs/aidlc-state.md`에서 현재 진행 상태 확인.
