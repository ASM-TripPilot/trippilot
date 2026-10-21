# docs/handoff — 에이전트 세션 인수인계

여러 코딩 에이전트(로컬 Claude Code · `claude --cloud` · Kiro CLI · 그 외 CLI)가 **같은 작업을 서로 이어받기 위한 상태 저장소**다.
세션 기록·메모리·worktree 는 한 머신에만 있지만, 이 디렉토리는 리포에 있어 GitHub 을 클론하는 누구든 읽는다.

## 구조

```
docs/handoff/
  README.md               ← 이 파일(규약)
  YYYY-MM-DD/
    index.md              ← 그날의 상황판: 세션 표·열린 PR·WIP 브랜치·서버 상태·공통 규칙
    <area>-<sid8>-<slug>.md  ← 세션 하나 = 문서 하나
```

`area` 는 세션 cwd 기준: `root`(리포 루트) · `ai`(ai/) · `wt-<이름>`(.claude/worktrees/<이름>). `sid8` 은 Claude 세션 UUID 앞 8자.

## 이어받는 쪽 절차 (어느 도구든 같다)

1. 가장 최근 날짜의 `index.md` 를 읽는다. "무슨 일이 있었나" → "세션 표" 에서 맡을 세션을 고른다. **진행중 > 리뷰-대기 > 확인-대기** 순.
2. 그 세션 문서의 frontmatter 로 브랜치·worktree 를 확인하고, "다음에 이어서 할 일" 을 위에서부터 집행한다. "함정 / 주의" 는 집행 전에 읽는다.
3. 작업을 시작하면 그 문서 frontmatter 에 `picked_up_by: <도구> <날짜 시각>` 한 줄을 추가하고 커밋한다 — 다른 에이전트가 같은 세션을 집지 않게.
4. 끝나면 "멈춘 지점" 과 "다음에 이어서 할 일" 을 현재 상태로 고쳐 쓴다. 완료면 `status: 완료`.
5. 하루가 끝나면(또는 한도에 걸리면) 새 날짜 디렉토리를 만들지 말고 **같은 날짜 문서를 갱신**한다. 새 디렉토리는 "세션들이 새로 크게 갈라진 날" 에만.

## 도구별 주의

| 도구 | 볼 수 있는 것 | 못 보는 것 |
|---|---|---|
| 로컬 Claude Code | 전부 (`claude --resume <UUID>` 로 원래 대화까지) | — |
| `claude --cloud` | GitHub 에 push 된 브랜치·이 문서 | `~/.claude` 메모리, `.claude/worktrees/`·`/Users/juna/dev/trippilot/wt-*`, llm-wiki 볼트, claude.ai artifact, AWS/kubectl 자격 |
| Kiro CLI | 로컬 파일 전부, git | Claude 세션 기록은 jsonl 원문만(`~/.claude/projects/...`) — `claude --resume` 불가 |

- 클라우드 세션이 이어받을 작업은 **반드시 브랜치가 push 되어 있어야** 한다. 문서의 "인수인계 때 push 한 WIP 브랜치" 표를 본다.
- `wip(handoff …)` 커밋은 검증 없이 보존용으로 만든 것이다. PR 전에 테스트하고 squash 한다.
- 로컬 전용 자원이 필요한 단계(서버 로그, 실기기, 로컬 DB)는 문서에 "로컬 전용" 으로 표시돼 있다. 클라우드는 그 단계를 건너뛰고 사용자에게 넘긴다.

## 작성 규칙 (쓰는 쪽)

- 한국어. 코드 재서술 금지 — "무엇을 왜 하고 있었고, 어디서 멈췄고, 다음에 뭘 하면 되는지".
- 티켓·PR·커밋 해시·수치는 확인된 것만. 추정이면 `(추정)`.
- 사용자가 내린 결정·거절한 안·되돌린 것은 "함정 / 주의" 에 반드시 남긴다.
- 세션 문서 템플릿은 `2026-10-20/` 의 아무 문서나 복사한다(frontmatter: session·area·cwd·branches_seen·current_branch·span_kst·ended_by·status·resume_local·related_prs·tickets).
- 비밀값(키·토큰·접속 주소)은 쓰지 않는다. 키 이름만.
