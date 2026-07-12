# Pull Request

해당 문서는 프로젝트의 Pull Request 규칙을 위한 문서입니다.

## 기본 규칙

- 모든 변경은 PR로만 develop/main에 들어갑니다 (직접 push는 보호 규칙으로 차단됩니다).
- **PR 제목: Conventional Commits 형식 + Jira 이슈 키** — squash merge 시 PR 제목이 그대로 커밋 메시지가 되기 때문입니다.

  ```
  feat: add login API endpoint (PROJ-123)
  fix: handle expired refresh token (PROJ-456)
  ```

- PR 본문은 한국어로 작성합니다. [.github/PULL_REQUEST_TEMPLATE.md](../../.github/PULL_REQUEST_TEMPLATE.md) 템플릿이 자동으로 채워집니다.
- PR은 작게 유지합니다. 리뷰가 힘들 만큼 커졌으면 쪼갭니다 — 대략 400줄 변경을 넘으면 분할을 고민합니다.

## Jira 연결

이슈 키가 **소스 브랜치명 또는 PR 제목**에 있으면 Jira가 PR을 이슈에 자동으로 연결합니다. 우리는 둘 다 넣습니다(브랜치는 규칙상, 제목은 squash 커밋에 남기기 위해). 키는 반드시 대문자로 씁니다.

## 머지 방식: Squash만

> AI 코딩 도구를 쓰면 작업 브랜치에 자잘한 커밋이 수십 개 쌓입니다. Squash merge는 이를 PR 단위 커밋 하나로 합쳐 develop/main 히스토리를 "PR 목록 = 변경 이력"으로 깔끔하게 유지하고, fast-forward로 머지되어 히스토리가 선형이 됩니다. 잃는 것은 개별 커밋의 타임스탬프·SHA인데, 우리 규모에서는 PR 페이지에 원본 커밋이 남아 있는 것으로 충분합니다.


## 리뷰 정책 (단계별)

| 단계 | 목적 | 리뷰 |
|---|---|---|
| `feature/*` → `develop` | 코드 품질 검증 | CI 통과 + 코드 리뷰 |
| `develop` → `main` | 릴리즈 확인 | CI 통과 필수. 코드 리뷰는 생략 |

## PR 작성자 체크리스트

- [ ] 제목이 `type: description (PROJ-123)` 형식
- [ ] 셀프 리뷰 완료 (Files changed 탭을 본인이 한 번 훑기)
- [ ] CI 통과
- [ ] 필요한 테스트·문서 포함 (해당 없으면 체크)
