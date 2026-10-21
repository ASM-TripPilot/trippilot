---
inclusion: always
---

# 세션 인수인계 (Kiro용)

- 리포 규칙·구조·명령은 `CLAUDE.md` 가 정본이다. Kiro 도 같은 규칙을 따른다(한국어, 코드 재서술 금지, 추측 금지).
- 다른 에이전트(Claude Code 로컬/클라우드)가 하던 작업을 이어받으려면 `docs/handoff/<최근 날짜>/index.md` → 세션 문서의 "다음에 이어서 할 일" 순으로 읽는다. 규약은 `docs/handoff/README.md`.
- 작업을 집으면 그 세션 문서 frontmatter 에 `picked_up_by: kiro <YYYY-MM-DD HH:MM>` 을 적고, 끝나면 "멈춘 지점"·"다음에 이어서 할 일" 을 갱신한다.
- Claude 세션 원문은 `~/.claude/projects/<프로젝트 경로 해시>/<UUID>.jsonl` 에 있다(로컬 전용). `claude --resume` 은 Kiro 에서 못 쓰므로 필요하면 jsonl 에서 사용자 메시지·마지막 어시스턴트 발화만 뽑아 본다.
- worktree 는 `/Users/juna/dev/trippilot/wt-*` 와 `.claude/worktrees/*` 에 있다. 미커밋 작업이 있으면 `wip(handoff …)` 커밋으로 보존한 뒤 push 한다(브랜치가 push 돼 있어야 클라우드 세션이 이어받는다).
