# AGENTS.md

이 모노레포(`ASM-TripPilot/trippilot`)에서 일하는 모든 코딩 에이전트(Codex · Kiro CLI · OpenCode · 그 외)를 위한 진입점이다. Claude Code 는 `CLAUDE.md` 를 자동으로 읽으므로 이 파일은 그 밖의 도구용이다.

1. **리포 규칙·구조·빌드/테스트 명령은 `CLAUDE.md` 가 정본이다.** 먼저 읽는다. 패키지별 규칙은 `frontend/CLAUDE.md`, `ai/README.md`, `backend/docs/design/`.
2. **이어받을 작업은 `docs/handoff/<최근 날짜>/index.md` 에 있다.** 규약은 `docs/handoff/README.md`. 작업을 집으면 해당 세션 문서 frontmatter 에 `picked_up_by: <도구> <날짜 시각>` 을 적고 커밋한다.
3. 팀 언어는 한국어(커밋·PR·문서). 브랜치·커밋·PR 규약은 `docs/conventions/`.
4. 실패에서 배운 규칙은 `docs/conventions/anti-patterns.md` — 착수 전 관련 영역을 읽는다.
5. 비밀값은 어디에도 쓰지 않는다. `.env*` 는 읽기만.
