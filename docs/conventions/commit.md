# 커밋 컨벤션 (Conventional Commits)

해당 문서는 프로젝트의 커밋 컨벤션을 위한 문서입니다.

## 단위

커밋 하나는 **의미 있는 작업 한 덩어리**여야 합니다. 나중에 되돌리거나 리뷰할 때 하나로 묶이는 게 자연스러운 크기로 자릅니다. 반대로, 그 자체로는 의미가 완결되지 않는 기계적인 동작 하나만으로는 커밋하지 않습니다.

- 권장 — 의미가 완결된 단위
    - 프로젝트를 처음 생성한 경우
    - 오타를 고친 경우
    - 여러 개의 의존성을 설치해 프로젝트 기반을 만든 경우
    - 의존성을 설치하고 실제 코드에 정의·적용까지 한 경우
- 지양 — 동작 하나로 끝나 의미가 불완전한 단위
    - 의존성만 설치하고 아무 데도 쓰지 않은 경우

## 형식

```
<type>(<scope>): <description>

[body — 선택]

[footer — 선택]
```

```bash
# 최소 형태 (대부분 이걸로 충분)
git commit -m "feat: add login API endpoint"

# scope 포함
git commit -m "fix(auth): handle expired refresh token"
```

## Type 목록

스펙이 강제하는 것은 `feat`과 `fix` 두 개뿐이고, 나머지는 Angular 컨벤션 기반의 사실상 표준입니다. 아래 표의 타입만 사용하기를 권장합니다.

| type | 용도 | 예시 |
|---|---|---|
| `feat` | 새 기능 | `feat: add password reset flow` |
| `fix` | 버그 수정 | `fix: prevent duplicate form submission` |
| `refactor` | 동작 변화 없는 구조 개선 | `refactor: extract token validation helper` |
| `docs` | 문서만 변경 | `docs: update API usage in README` |
| `test` | 테스트 추가·수정 | `test: add cases for date parser` |
| `chore` | 빌드·설정·의존성 등 잡무 | `chore: bump eslint to v9` |
| `style` | 포맷팅 등 코드 의미 무관 변경 | `style: apply prettier` |
| `perf` | 성능 개선 | `perf: cache user profile lookup` |
| `ci` | CI 설정 변경 | `ci: add lint step to workflow` |

- AI 도구가 만든 커밋이 많아도 괜찮습니다 — 어차피 PR에서 squash됩니다. 다만 **squash 후 남을 PR 제목은 이 컨벤션을 지켜야 합니다** (→ [pull-request.md](pull-request.md)).

## Jira 이슈 키 표기

이슈 키는 **브랜치명에 이미 있으므로 커밋마다 강제하지 않습니다.** 다만 커밋 메시지에 키를 넣으면 그 커밋이 Jira 이슈에 개별적으로 연결됩니다(대문자 필수). 넣을 경우 위치는 footer가 스펙에 맞는 자리입니다:

```
feat: add login API endpoint

Refs: PROJ-123
```

간단히 subject 끝에 붙이는 것도 허용합니다: `feat: add login API endpoint (PROJ-123)`

## 커밋 템플릿 설정

저장소 루트의 [.gitmessage](../../.gitmessage) 템플릿을 등록하면 `git commit`(에디터 모드) 때 형식이 자동으로 뜹니다:

```bash
git config commit.template .gitmessage
```
