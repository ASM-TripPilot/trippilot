# TripPilot AI — 프로젝트 루트

## 프로젝트 개요

TripPilot AI는 LLM + 최적화 솔버 하이브리드 아키텍처로 여행 일정을 생성·재계획·회고하는 **독립 Python AI 서비스**입니다.

## 핵심 구조

- `aidlc-docs/` — AI-DLC 워크플로우 산출물 (설계·요구사항·계획)
- `.kiro/` — Kiro IDE steering + AI-DLC 규칙 상세
- `README.md` — 전체 설계 개요 (최신 정보의 기준)

## 4대 불변식

1. **INV-1**: LLM은 closed-set 후보 안에서만 선택 (환각 0)
2. **INV-2**: 사용자에게 보이는 시각·순서는 솔버 검증값만
3. **INV-3**: 소요시간 미표시 — 거리만
4. **INV-4**: AI 실패 시 결정론 폴백 (침묵 실패 금지)

## 멀티에이전트 구조 (2계층 — 업무 + 정보)

**업무 계층** (agent-redesign.md):
- **Orchestrator**: 의도 파악(하이브리드 질문뱅크 매칭) + Fast Path + AgentTask 봉투로 병렬 디스패치
- **ScheduleAgent**: 일정 생성 (Generation 패턴)
- **PlanBAgent**: 변수 대응 (RAG 패턴, KB 3종 + pgvector)
- **ReflectAgent**: 회고 생성 (1차: 단순 LLM Generation. 추후 Multi-step 확장)
- **EditAgent**: 일정 편집 (의도 해석 → 솔버 검증 → 반영)

**정보 계층** (agent-hierarchy-design.md — 업무 에이전트가 agent-as-tool로 호출):
- **PlaceScoutAgent**(장소 후보, INV-1 관문) / **WeatherAgent**(일단위 날씨+트리거) / **TransitAgent**(교통·거리+지연 트리거) / **PersonaAgent**(KB-2) / **EventAgent**(행사, P2)
- 규칙: 깊이 2 고정, 쓰기 금지, 응답에 FreshnessMeta 필수

에이전트별 필요한 tool만 할당 (토큰 50~60% 절감).

## 핵심 설계 문서 (application-design/)

- 위임 프로토콜: `orchestrator-delegation-design.md` (AgentTask/AgentResult, deadline 상속, trace_id)
- 입출력 계약: `agent-io-contracts.md` (FE↔BE↔Agent 대응)
- 의도 파악: `intent-matching-design.md` / 평가 지표(최신성·신속도): `evaluation-metrics-design.md`
- MLOps/LLMOps + ML 유형화: `mlops-llmops-design.md`

## Solver 하이브리드 전략

OR-Tools (1차 결정론) → LLM(Anthropic) (2차 창의적 제안) → 규칙 폴백 (최후 보장)
모든 출력은 HC1~HC4 검증 통과 필수.

## 기술 스택

- Python 3.11+ / Anthropic API 직접 (Claude — AI-D06) / OR-Tools
- LangChain (부분 도입 — PlanBAgent RAG + LLM 호출에만)
- pgvector / Titan Embeddings v2 / pytest + Hypothesis (PBT 19속성)

## 현재 상태

INCEPTION 완료. 멘토 피드백 반영 완료 (에이전트 업무 기준 재설계).
다음: CONSTRUCTION Phase (U1 Domain & Ports부터).

## AI-DLC 규칙

`.kiro/aws-aidlc-rule-details/`에 상세 규칙.
`aidlc-docs/aidlc-state.md`에서 현재 진행 상태 확인.
