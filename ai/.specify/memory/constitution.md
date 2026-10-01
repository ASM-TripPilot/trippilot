# TripPilot AI 헌법

> 이 문서는 spec-kit(`/speckit-*`)과 서브에이전트가 매 단계 읽는 **규칙 요약본**이다.
> 정본은 리포에 있다 — 충돌하면 `README.md`·`aidlc-docs/`·루트 `CLAUDE.md`·
> `docs/conventions/anti-patterns.md` 가 이긴다. 여기엔 "무엇을 어기면 재설계인가"만 적는다.

## Core Principles

### I. 4대 불변식 (위반 = 재설계, 협상 불가)
- **INV-1** LLM 은 닫힌 후보 집합에서만 고른다. 웹 소싱 POI 는 수집 게이트 → place-data 등록 후에만 후보.
- **INV-2** 사용자에게 보이는 시각·순서는 어셈블리 검증값만. 라우터·워커는 *제안*만 한다.
- **INV-3** duration 은 절대 표시하지 않는다 — 거리만. 공개 DTO 에 `duration` 필드 금지.
- **INV-4** AI 실패 시 결정론 폴백. 조용한 실패(silent except·FallbackEvent 없는 폴백) 금지.

### II. 정본 먼저, 코드로 확인
- 착수 전 읽는 순서: 유닛 FD(`aidlc-docs/construction/<유닛>/functional-design/`) → inception 설계 → `README.md`. 둘이 다르면 construction FD 가 최신.
- 와이어 정본은 `docs/openapi.json` — 손으로 고치지 않고 `scripts/export_openapi.py` 로 재생성.
- 사실 확인은 언제나 코드다. 문서·노트·기억은 배경이다. 부재 주장("없다")은 `origin/develop` 기준으로 확인한 뒤에만.

### III. 테스트 우선 + PBT 게이트 (차단 게이트)
- 구현 전에 실패하는 테스트를 먼저 쓴다(red → green → refactor). 테스트를 약화시켜 통과시키지 않는다.
- 불변식·업무규칙(BR-*)은 hypothesis 속성 테스트로 증명한다. 적대적 속성(오염 입력에도 불변식 유지) 우선.
- **CI 에서 실 외부 API 호출 0건** — LLM·거리·지도·날씨 전부 fake(`tests/fakes/`). 결정론: `datetime.now()`·시드 없는 random 금지.
- 완료 주장 전 `uv run pytest tests/ -q` 전체 green 을 눈으로 확인한다. 증거 없이 "통과"라 말하지 않는다.

### IV. 최소 코드 (ponytail)
- 필요 없으면 안 만든다(YAGNI) → 리포에 있으면 재사용 → 표준 라이브러리 → 이미 설치된 의존성 → 한 줄 → 그다음에야 새 코드.
- 구현 하나뿐인 인터페이스·미래용 스캐폴딩·바뀌지 않는 값의 설정화 금지. 요청 범위 밖의 리팩터·포맷 수정 금지.
- 의도적으로 자른 모서리는 `# ponytail:` 주석으로 상한과 승격 경로를 남긴다.
- 게으름은 해법의 크기에만 적용된다. 문제 이해·호출자 전수 확인·근본 원인은 줄이지 않는다.

### V. 아키텍처 경계 (`tests/test_architecture.py` 가 강제)
- `domain`·`ports` 는 표준 라이브러리 + 내부 패키지만 import. 외부 SDK 는 `adapters` 한정, yaml 은 `llm_gateway/prompts.py` 한정, anthropic 은 `llm_gateway/adapters` 한정.
- 외부 API 하나 = Port 인터페이스 하나 = 소유 어댑터 하나. c1(llm_gateway) ↛ c2·m7.
- 공유 파일 append 대신 새 파일 추가(게이트·워커·프롬프트) — 병렬 세션 충돌 방지. `api/wiring.py` 는 경합 1위: 자동 정렬 금지, 최소 줄만.

## 추가 제약
- 언어는 한국어(코드 식별자·주변이 영어면 영어). 커밋·PR 에 `Co-Authored-By`·세션 링크·Claude 트레일러 금지.
- 티켓 키(`TRIP-nnn`)는 조회해 제목을 확인한 뒤에만 적는다. 브랜치명에 키를 넣지 않는다. PR 본문의 키는 Jira 자동화가 닫는다.
- 모델 문자열 하드코딩 금지(설정 경유). 모델 출력물로 모델 학습 금지(오픈 웨이트 교사만).
- 커밋은 메인 체크아웃이 아니라 워크트리에서. 작업트리는 다른 세션과 공유된다.

## 개발 워크플로우 (spec-kit ↔ 팀 8단계)
| 팀 8단계(`docs/conventions/workflow-8steps.md`) | spec-kit | 담당 |
|---|---|---|
| 정의 · 정의서 | `/speckit-specify` (+`/speckit-clarify`) → `specs/NNN-<이름>/spec.md` | 메인 세션 |
| 테스트 시나리오 | `/speckit-plan` → `plan.md` + FD 의 PBT 게이트 표 | fd-designer · pbt-writer |
| 구현 | `/speckit-tasks` → `tasks.md` → `/speckit-implement` | worker-builder (ponytail + TDD) |
| 테스트 수행 · 리포트 | `pytest` 전체 green + invariant-reviewer 위반 0 | pbt-writer · invariant-reviewer |
| 구현 리포트 · 매뉴얼 | PR 본문 절 · `README`/openapi 갱신 | 메인 세션 |

- **규모별 보정**: 스토리·유닛·새 워커 = 전체. 버그픽스·chore = spec 생략, 구현·테스트·리포트만. 의식(儀式) 금지.
- 브랜치는 spec-kit 이 만들지 않는다(git 확장 미설치). 팀 규약(`docs/conventions/`)대로 워크트리에서 만든다.
- `specs/` 는 spec-kit 산출물 자리다. 이전 `docs/superpowers/{specs,plans}` 는 역사로 두고 새로 만들지 않는다.

## Governance
- 이 헌법은 리포 정본의 **요약**이다. 정본이 바뀌면 여기를 따라 고친다(반대 방향 금지). 개정은 semver 로 버전을 올리고 PR 로 남긴다.
- 모든 spec·plan·tasks 는 "Constitution Check" 절에서 I·III·V 위반 여부를 명시한다. 위반이 있으면 정당화가 아니라 재설계다.
- 새로 재현·검증된 실패는 `docs/conventions/anti-patterns.md` 에 한 줄 규칙으로 추가 제안한다.

**Version**: 1.0.0 | **Ratified**: 2026-09-24 | **Last Amended**: 2026-09-24
