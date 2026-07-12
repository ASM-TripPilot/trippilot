# 기여 가이드

이 문서는 **진입점**입니다. 실제 규칙은 [`docs/conventions/`](docs/conventions/README.md), 제품·설계 정본은 [`docs/planning/`](docs/planning/README.md)에 있습니다. 여기선 복붙하지 않고 링크만 겁니다.

## 30초 요약

```bash
git checkout develop && git pull                # 0순위: 항상 develop 최신화
git checkout -b feature/TRIP-123-short-desc     # <type>/<JIRA-KEY>-<설명>
# ... 작업 & 커밋 (Conventional Commits) ...
git push -u origin feature/TRIP-123-short-desc
# GitHub에서 PR → 리뷰 → squash merge
```

- 브랜치·커밋·PR에 **Jira 키(`TRIP-123`, 대문자)** 를 넣으면 지라·깃허브·슬랙이 자동으로 이어집니다.
- `develop`·`main`엔 직접 push 금지 — PR로만.

## 더 읽기

| 문서 | 내용 |
|---|---|
| [conventions/branch.md](docs/conventions/branch.md) | 브랜치 전략·네이밍 |
| [conventions/commit.md](docs/conventions/commit.md) | 커밋 컨벤션 |
| [conventions/pull-request.md](docs/conventions/pull-request.md) | PR 규칙·squash·리뷰 |
| [guides/jira.md](docs/guides/jira.md) | 지라 사용법 |
| [guides/slack.md](docs/guides/slack.md) | 슬랙 사용법 |
| [planning/](docs/planning/README.md) | 제품·설계 정본 |
| [CLAUDE.md](CLAUDE.md) | AI 에이전트 작업 지침 |

## 처음 한 번

```bash
git config commit.template .gitmessage   # 커밋 템플릿 등록
```
