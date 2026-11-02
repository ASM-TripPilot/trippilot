# TripPilot AI — 프로젝트 루트

> English version: ./claude.md

## 프로젝트 개요

TripPilot AI는 LLM + 최적화 어셈블리 하이브리드 아키텍처로 여행 일정을 생성·재계획·회고하는 **독립 Python AI 서비스**입니다.

## 4대 불변식

1. **INV-1**: LLM은 closed-set 후보 안에서만 선택 (환각 0)
2. **INV-2**: 사용자에게 보이는 시각·순서는 어셈블리 검증값만
3. **INV-3**: 소요시간 미표시 — 거리만
4. **INV-4**: AI 실패 시 결정론 폴백 (침묵 실패 금지)

## 아키텍처 — 정본은 하나

**AI 아키텍처의 단일 정본은 `ARCHITECTURE.md`(2026-11-02)다.** 층, 백엔드↔AI 경계, 요청 흐름, 에이전트 6종,
오케스트레이터·Provider, LLM 게이트웨이, 조립 엔진, 데이터·KB, 배포, "설계됐지만 미배선" 목록이 모두 거기 있다 —
여기나 새 문서에 다시 쓰지 않는다. 옛 개요(README 구조 절·`ai-architecture`·`agent-structure-v2`·`agent-redesign`·`components` 등)는
"대체됨" 안내를 단 이력 문서다. 코드와 문서가 어긋나면 코드가 이기고 `ARCHITECTURE.md` 를 고친다.

세션이 가장 자주 틀리는 사실(믿기 전에 코드로 확인):
- **에이전트 6종**, 모두 `run(<Task>)` 객체(명단 정본 `agents/__init__.py`). `Agent.handle(AgentTask) -> AgentResult` 봉투는 여섯 다 미구현.
- 도우미 턴은 `TRIPPILOT_DIALOGUE_ORCHESTRATOR=on`(개발·운영 on, 코드 기본 off)이면 `DialogueOrchestrator`(LLM 직접 분류
  `DIALOGUE_INTENT`)를 탄다. 이때 3단 `IntentRouter` 는 섀도로만 돈다. 스위치가 off 면 `IntentRouter` 가 서비스 경로다.
- 조립 체인은 **2단**(`OrToolsAssembler` → `RuleFallbackAssembler`), LLM 2차 단계는 미배선.
- 판단 없는 단발 변환(공유 카드 문구·넛지·알림 문구)은 에이전트 없이 경계 → 워커 직행.
- 모델 배정은 배포 환경변수(`TRIPPILOT_LLM_FEATURE_MODELS`)가 정본 — 문서에 모델 이름을 박지 않는다.

## 기술 스택

- Python 3.11+ / FastAPI / OR-Tools / `llm_gateway` 어댑터 뒤의 LLM 벤더(Anthropic · OpenAI · Bedrock).
- pgvector(`ai_kb` DB) + 별도 임베딩 서비스의 **`nlpai-lab/KURE-v1`**.
- pytest + Hypothesis — 개수를 박지 않는다. `grep -rc --include="*.py" "@given" ai/tests` 로 센다.
- **테스트 배치는 `src/trippilot/` 를 거울로 한다**: 주로 다루는 패키지 폴더 `tests/<package>/` 에 둔다(에이전트는 에이전트별
  `tests/agents/<schedule|planb|reflect|edit|unknown_handling|recommendation>/`). `ai/scripts` 테스트는 `tests/scripts/`.
  `fakes/`·`fixtures/`·`generators/`·`test_architecture.py` 는 루트에 둔다.
- LangChain: **쓰지 않는다** — 의존성 0, import 0. RAG 는 psycopg + pgvector 로 직접 만들었다.

**와이어 정본은 `docs/openapi.json`** — 손으로 고치지 않는다. `scripts/export_openapi.py` 로 다시 만든다.
CI(`ai-ci`)가 "실행 앱 스키마 == 커밋된 계약"을 강제하고, 외부 API 는 전부 가짜로 돈다.

## 개발 워크플로우 (spec-kit + 서브에이전트)

이 패키지에 [spec-kit](https://github.com/github/spec-kit) 이 설치돼 있다(`.specify/`,
`.claude/skills/speckit-*`). 기능 작업은 `/speckit-specify` → (`/speckit-clarify`) →
`/speckit-plan` → `/speckit-tasks` → `/speckit-implement` 순서로 `specs/NNN-<이름>/` 을 만든다.
헌법 `.specify/memory/constitution.md` 는 리포 정본의 **요약**이다(4대 불변식 · 정본 위계 ·
TDD+PBT · ponytail 최소 코드 · 아키텍처 경계) — 어긋나면 정본이 이기고 헌법을 고친다.
팀 8단계 워크플로우와의 대응, 규모별 보정(버그픽스·chore 는 spec 생략)은 헌법에 있다.
spec-kit 은 브랜치를 만들지 않는다 — `docs/conventions/` 규약대로 워크트리에서 만든다.

**서브에이전트**(`.claude/agents/`)가 도구를 들고 다닌다:
- 코드 쓰는 쪽(`worker-builder`, `pbt-writer`)은 frontmatter `skills:` 로 `ponytail:ponytail` +
  `superpowers:test-driven-development` 를 프리로드하고, spec 디렉토리가 주어지면 `speckit-implement` 로
  진행하며, 끝에 `superpowers:verification-before-completion` 을 호출한다.
- `fd-designer` 는 FD 를 쓴 뒤 `speckit-plan` 을 호출한다(plan.md 는 FD 를 가리키기만 한다).
- `invariant-reviewer` / `canon-auditor` 는 spec 디렉토리가 있으면 `speckit-analyze` 를 호출한다.
  리뷰어의 `ponytail:ponytail-review` 는 과잉 설계 관점을 요청받았을 때만.
- 위임할 때 프롬프트에 spec 디렉토리 경로를 넘긴다(서브에이전트는 컨텍스트를 상속하지 않는다).

`ponytail`·`superpowers` 는 사용자 범위 Claude Code 플러그인이다. 없는 머신에서는 `skills:` 프리로드만
빠지고, 헌법에 요약된 규칙은 그대로 적용된다.

## AI-DLC 규칙

`.kiro/aws-aidlc-rule-details/`에 상세 규칙.
`aidlc-docs/aidlc-state.md`에서 현재 진행 상태 확인.
