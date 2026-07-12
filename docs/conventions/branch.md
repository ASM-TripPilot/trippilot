# 브랜치 전략 

해당 문서는 프로젝트의 Git Flow 브랜치 관리 전략을 위한 문서입니다.

## 브랜치 구성

메인 브랜치는 main. develop 브랜치가 해당되며, 그 외에 보조 브랜치는 feature, fix, hotfix 브랜치 등이 해당됩니다. 

| 브랜치 | 역할 | 수명 |
|---|---|---|
| `main` | 배포 대상이 되는 안정 브랜치. 항상 배포 가능한 상태 유지 | 영구 |
| `develop` | 작업을 모아 통합·검증하는 브랜치 | 영구 |
| `feature/*` `fix/*` `chore/*` `docs/*` | 개별 작업 브랜치. develop에서 분기 | 선택 |
| `hotfix/*` | main의 긴급 수정. main에서 분기 | 선택 |


## 흐름도

```
main    ──────────────●────────────────●──────   ← 릴리즈 시점에만 머지
                     ↗ PR             ↗ PR
develop ──●────●────●────●────●──────●────────   ← 작업 통합 + CI 검증
          ↖ PR ↖ PR      ↖ PR
feature/PROJ-123-…  fix/PROJ-456-…  feature/PROJ-789-…
```

1. Jira 이슈 확인 → `develop`에서 작업 브랜치 분기
2. 작업 완료 → PR로 `develop`에 머지
3. `develop`에서 통합 검증
4. 릴리즈 시점에 `develop` → `main` PR

## 브랜치 네이밍

**형식: `<type>/<JIRA-KEY>-<짧은-영문-설명>`**

```bash
git checkout -b feature/PROJ-123-login-api develop
git checkout -b fix/PROJ-456-token-expiry develop
git checkout -b chore/PROJ-789-update-deps develop
git checkout -b hotfix/PROJ-999-payment-crash main   # hotfix만 main에서 분기
```

규칙:

- **Jira 이슈 키는 반드시 대문자** — `PROJ-123`은 자동 연결되지만 `proj-123`은 Jira가 인식하지 못합니다.
- 설명은 소문자 영문 + 하이픈(`-`), 2~4단어면 충분합니다.
- type은 브랜치 구성의 기재된 타입만 사용합니다.

> 브랜치명에 이슈 키가 있으면 Jira가 브랜치·PR을 해당 이슈에 자동으로 연결해 줍니다. 별도 설정이나 수작업이 필요 없습니다.

## 브랜치 생명주기

> 무조건 먼저: `git checkout develop && git pull`
>
> **작업을 새로 시작하든 이어서 하든, 브랜치를 만들기 전에 develop부터 최신화합니다.**
>
> **이게 모든 작업의 **0순위 습관**입니다.**

```bash
# 1. 시작: develop 최신화 후 분기 (매번 먼저!)
git checkout develop && git pull
git checkout -b feature/PROJ-123-login-api

# 2. 작업 & 커밋 (커밋 컨벤션은 commit.md)
git push -u origin feature/PROJ-123-login-api

# 3. PR 생성 → 리뷰 → squash merge (pull-request.md)

# 4. 머지 후 (선택): 로컬 브랜치 정리
git checkout develop && git pull
git branch -d feature/PROJ-123-login-api   # 정리하고 싶을 때만
```

**작업 브랜치 삭제는 선택입니다.** 지워도 되고 남겨둬도 괜찮습니다. 다만 한 가지, squash merge된 브랜치에서 그대로 작업을 이어가면 이미 머지된 커밋이 다음 PR에 다시 나타나 충돌이 생길 수 있습니다(GitHub 공식 문서 안내). 그러니 이어서 할 작업이 있다면 그 브랜치를 재사용하기보다 develop에서 새로 만드는 편이 편합니다. 브랜치가 쌓여 헷갈릴 때 가볍게 정리해 주는 정도면 충분합니다.

## hotfix 흐름 (긴급 수정)

배포된 main에 급한 버그가 생기면 develop을 거치지 않고 main에서 바로 분기합니다.

```bash
# main에서 분기 → 수정 → PR로 main에 머지
git checkout -b hotfix/PROJ-999-payment-crash main
```

머지 후에는 **같은 수정을 develop에도 반영**합니다(main → develop PR 또는 머지). 이 과정을 빼먹으면 develop에는 수정이 없어 다음 릴리즈에서 같은 버그가 되살아납니다.

## 하지 말 것

- develop/main에 직접 push — 브랜치 보호 규칙으로 차단됩니다.
- 장수(long-lived) 작업 브랜치 — 브랜치는 며칠 안에 머지하는 것을 목표로 하고, 커지면 쪼개서 관리합니다.

