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

## 멀티에이전트 구조 (업무 기준)

- **Orchestrator**: 의도 파악 + Fast Path(간단한 task 직접 처리) + 에이전트 병렬 디스패치
- **ScheduleAgent**: 일정 생성 (Generation 패턴, tool 6개)
- **PlanBAgent**: 변수 대응 (RAG 패턴, KB 3종 + pgvector, tool 7개)
- **ReflectAgent**: 회고 생성 (1차: 단순 LLM Generation, tool 2개. 추후 Multi-step 확장)
- **EditAgent**: 일정 편집 (의도 해석 → 솔버 검증 → 반영, tool 5개)

에이전트별 필요한 tool만 할당 (토큰 50~60% 절감).

## Solver 하이브리드 전략

OR-Tools (1차 결정론) → Bedrock LLM (2차 창의적 제안) → 규칙 폴백 (최후 보장)
모든 출력은 HC1~HC4 검증 통과 필수.

## 기술 스택

- Python 3.11+ / AWS Bedrock (Claude) / OR-Tools
- LangChain (부분 도입 — PlanBAgent RAG + Bedrock 호출에만)
- pgvector / Titan Embeddings v2 / pytest + Hypothesis (PBT 19속성)

## 현재 상태

INCEPTION 완료. 멘토 피드백 반영 완료 (에이전트 업무 기준 재설계).
다음: CONSTRUCTION Phase (U1 Domain & Ports부터).

## AI-DLC 규칙

`.kiro/aws-aidlc-rule-details/`에 상세 규칙.
`aidlc-docs/aidlc-state.md`에서 현재 진행 상태 확인.
