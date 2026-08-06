# design-artifacts — AI 설계 정본

> English version: ./claude.md

이 폴더에는 TripPilot AI 서비스의 **설계 정본 문서**가 있습니다.
루트에 있던 ai-*.md 파일들이 여기로 구조화되었습니다.

## 문서 계층 (의존 순서)

| 계층 | 문서 | 역할 |
|---|---|---|
| L1 | ai-architecture.md | 전략·아키텍처 (WHAT/WHY). 4대 불변식 |
| L2 | ai-implementation-design.md | 구현 설계 (HOW). 인터페이스·시퀀스·알고리즘 |
| L3 | ai-data-design.md | M7 데이터 계층. POI 스키마·후보 풀·캐싱 |
| L4 | ai-prompt-design.md | C1 feature별 프롬프트·OutputSchema |
| L5 | ai-testing-guide.md | PBT 속성 19개·oracle·fake·CI |
| L6 | ai-adr.md | 아키텍처 결정 근거 (ADR-0008~0015, AI-D01~D05) |
| — | ai-cost-estimation.md | 비용 추정 |

## 주의

- 이 문서들은 **정본**입니다. 수정 시 변경 이력을 기록하세요.
- 에이전트 구조는 `agent-redesign.md`(application-design/)가 최신입니다.
  이 폴더의 ai-implementation-design.md §3.4(워커 구조)는 **구 설계**이며 agent-redesign.md로 대체됩니다.
