# application-design — 컴포넌트·서비스 설계

> English version: ./claude.md

이 폴더는 코드 구현 직전 수준의 상세 설계를 담습니다.

## 파일 목록

- `components.md` — C1·C2·M7·API·Ports·Domain 내부 모듈 분해, 의존 규칙
- `component-methods.md` — 공개/내부 메서드 시그니처 + 비즈니스 규칙
- `services.md` — 오케스트레이션 플로우, 에러 경로, 상태 전이, 횡단 관심사
- `agent-redesign.md` — **업무 에이전트 4종 구조** (멘토 피드백 반영)
- `agent-structure-v2.md` — **최신 정본: 4상자 파이프라인** (Orchestrator/Provider 5종/Agent 4종/Assembly 관문 — 도구 겹침 0)
- `agent-hierarchy-design.md` — (구판) 2계층 세분화 — v2로 대체됨
- `agent-io-contracts.md` — **입출력 계약** (FE 화면 IO ↔ BE DB·API ↔ Agent I/O 대응 + FreshnessMeta)
- `orchestrator-delegation-design.md` — **위임 프로토콜** (AgentTask/AgentResult 봉투, context_refs, deadline 상속, trace_id)
- `intent-matching-design.md` — **의도 파악 하이브리드** (질문뱅크 임베딩 매칭 + LLM 유사질문 투표)
- `evaluation-metrics-design.md` — **평가 지표 2축** (최신성 F1/F2, 신속도 SLO)
- `mlops-llmops-design.md` — **MLOps/LLMOps 운영 체계** + ML 패턴 유형화 (4유형 10후보)
- `planb-rag-design.md` — **PlanBAgent RAG 설계** (벡터 스토어, retrieve 전략, 파이프라인)
- `langchain-adoption.md` — **LangChain 부분 도입** (적용 범위 + 이유 + 미적용 부분)
- `reflect-agent-design.md` — **ReflectAgent 설계** (1차 A: 단순 LLM, 추후 C: Multi-step)

## 중요: 에이전트 구조의 최신 정본

멘토 피드백으로 워커(tool 기준) → 에이전트(업무 기준)로 재설계됨 (`agent-redesign.md`).
2026-07-16에 `agent-hierarchy-design.md`가 2계층화, **2026-08-02에 `agent-structure-v2.md`가 도구 배타 원칙(멘토 피드백)으로 재개정** — 정보 에이전트→Provider 개명, Assembly 공통 관문화.
최신 정본은 agent-structure-v2.md입니다.

핵심 변경점:
- 업무 기준 에이전트 4종 (Schedule/PlanB/Reflect/Edit)
- Orchestrator Fast Path (간단한 task 직접 처리)
- 에이전트 간/내부 병렬 실행
- Assembly 하이브리드 (OR-Tools → Bedrock → 규칙 폴백)
- PlanBAgent: RAG 기반 (KB 3종 + pgvector)
- ReflectAgent: 1차 단순 LLM Generation, 추후 Multi-step 확장
- 에이전트별 Tool 제한 (토큰 절감)
- LangChain 부분 도입 (Bedrock + RAG만)
