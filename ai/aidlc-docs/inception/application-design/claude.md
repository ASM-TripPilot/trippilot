# application-design — 컴포넌트·서비스 설계

이 폴더는 코드 구현 직전 수준의 상세 설계를 담습니다.

## 파일 목록

- `components.md` — C1·C2·M7·API·Ports·Domain 내부 모듈 분해, 의존 규칙
- `component-methods.md` — 공개/내부 메서드 시그니처 + 비즈니스 규칙
- `services.md` — 오케스트레이션 플로우, 에러 경로, 상태 전이, 횡단 관심사
- `agent-redesign.md` — **최신 에이전트 구조** (멘토 피드백 반영)
- `planb-rag-design.md` — **PlanBAgent RAG 설계** (벡터 스토어, retrieve 전략, 파이프라인)
- `langchain-adoption.md` — **LangChain 부분 도입** (적용 범위 + 이유 + 미적용 부분)
- `reflect-agent-design.md` — **ReflectAgent 설계** (1차 A: 단순 LLM, 추후 C: Multi-step)

## 중요: agent-redesign.md가 최신

멘토 피드백으로 워커(tool 기준) → 에이전트(업무 기준)로 재설계됨.
이 파일이 components.md·services.md의 에이전트 관련 내용을 대체합니다.

핵심 변경점:
- 업무 기준 에이전트 4종 (Schedule/PlanB/Reflect/Edit)
- Orchestrator Fast Path (간단한 task 직접 처리)
- 에이전트 간/내부 병렬 실행
- Solver 하이브리드 (OR-Tools → Bedrock → 규칙 폴백)
- PlanBAgent: RAG 기반 (KB 3종 + pgvector)
- ReflectAgent: 1차 단순 LLM Generation, 추후 Multi-step 확장
- 에이전트별 Tool 제한 (토큰 절감)
- LangChain 부분 도입 (Bedrock + RAG만)
