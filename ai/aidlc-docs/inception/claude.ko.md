# inception — INCEPTION Phase 산출물

> English version: ./claude.md

INCEPTION Phase에서 생성된 모든 문서가 여기 있습니다.
"WHAT을 WHY 그렇게 만드는가"를 정의합니다.

## 하위 폴더

- `design-artifacts/` — ai-*.md 설계 정본 (아키텍처·구현·데이터·프롬프트·테스트·ADR·비용)
- `reverse-engineering/` — 기존 설계 문서 분석 산출물 8개
- `requirements/` — 기능/비기능 요구사항 (FR 5그룹 + NFR 6그룹)
- `plans/` — Execution Plan (6유닛 분해, 실행 순서)
- `application-design/` — 컴포넌트·메서드·서비스 계층 + **에이전트 재설계**(멘토 피드백)
- `units/` — Units of Work (유닛 정의·의존·스토리 매핑)
- `user-stories/` — (SKIP — 내부 AI 서비스)

## 읽는 순서 (컨텍스트 로드)

1. `design-artifacts/README.md` — 설계 문서 계층 인덱스
2. `requirements/requirements.md` — 요구사항 전체
3. `plans/execution-plan.md` — 실행 계획
4. `application-design/agent-redesign.md` — 최신 에이전트 구조 (멘토 피드백 반영)
5. `units/unit-of-work.md` — 유닛 분해
