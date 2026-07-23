# 지라 사용법

도구 **사용법** 문서입니다. 지켜야 할 규칙은 [../conventions/](../conventions/README.md)에 있습니다.

- 사이트: `juna265.atlassian.net`
- 프로젝트 키: **`TRIP`** — 모든 이슈가 `TRIP-1`, `TRIP-2` … 로 매겨집니다.

## 이슈 계층

```
Epic (E0~E13 · aidlc/aidlc-docs/planning/jira 참고)
└─ Story / Task     ← 실제 작업 단위, 브랜치 하나에 대응
   └─ Sub-task      ← 더 쪼갤 때
```

## Smart Commit — 커밋/PR에서 지라 조작

커밋 메시지나 PR에 키와 명령을 넣으면 지라가 자동 반영합니다 (**키는 반드시 대문자**).

| 문법 | 효과 |
|---|---|
| `TRIP-123` | 그 커밋/PR을 이슈에 연결 |
| `TRIP-123 #comment 메모` | 이슈에 댓글 추가 |
| `TRIP-123 #time 2h` | 작업시간 기록 |
| `TRIP-123 #done` | 이슈 상태 전이 |

예: `git commit -m "feat: 소셜 로그인 (TRIP-123)"`

## 브랜치·PR 자동 연결

브랜치명 `feature/TRIP-123-...` 또는 PR 제목에 키가 있으면, 지라 이슈의 **개발(Development) 패널**에 브랜치·PR·커밋이 자동으로 뜹니다. 별도 수작업 불필요.

## 상태 흐름

| 지라 상태 | 시점 |
|---|---|
| To Do | 백로그, 착수 전 |
| In Progress | 브랜치 만들어 작업 시작 |
| In Review | PR 올림 |
| Done | PR squash merge (또는 `#done`) |

브랜치 전략과의 매핑은 [../conventions/branch.md](../conventions/branch.md).
