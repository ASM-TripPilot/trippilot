# 로컬 Kubernetes 구동 (TRIP-325)

backend · frontend · ai 를 로컬 kind 클러스터 하나에서 함께 띄운다.
빌드·테스트 진입점은 `just`, 컨테이너 이미지와 ai 패키지는 `Bazel` 이 소유한다.

> 사전 준비: Docker Desktop · kind · kubectl · bazelisk · just.
> 설치 절차는 [docs/installs/k8s_install.md](../docs/installs/k8s_install.md).
> `just doctor` 로 무엇이 빠졌는지 한 번에 확인할 수 있다.

## 한 줄로 띄우기

```bash
just up      # 클러스터 생성 → backend 빌드 → 이미지 3종 → 배포
just smoke   # 세 서비스가 실제로 응답하는지 확인
just down    # 클러스터 삭제 (데이터 포함)
```

배포가 끝나면 이 주소들이 열린다.

| 서비스 | 주소 |
|---|---|
| frontend | http://localhost:8080 |
| backend | http://localhost:8081/actuator/health |
| ai | http://localhost:8082/health |
| postgres | localhost:15432 (db=trippilot user=app_user pw=app_user) |

포트는 `deploy/kind/cluster.yaml` 의 NodePort → hostPort 매핑으로 고정돼 있다.
`port-forward` 는 쓰지 않는다 — 터미널을 붙잡고 있어야 하고 끊기면 조용히 죽는다.

## 자주 쓰는 것

```bash
just status          # 파드·서비스 상태
just logs backend    # 로그 따라가기 (backend · ai · frontend)
just update          # 이미지 새로 만들고 파드만 교체 (클러스터 유지)
just db-shell        # psql 접속
just undeploy        # 매니페스트만 제거 (클러스터·데이터 유지)
```

## 누가 무엇을 소유하는가

| 대상 | 소유 도구 | 이유 |
|---|---|---|
| backend 빌드·테스트 | Gradle | Konsist·ArchUnit·Kotest PBT·Flyway·Testcontainers 가 모두 Gradle 게이트 위에 있다 |
| frontend 빌드·테스트 | pnpm | Expo prebuild·Metro·Jest |
| ai 빌드·테스트 | **Bazel** (rules_python) | 의존성이 pyproject 하나로 끝나고 재구축할 게이트가 없었다 |
| 컨테이너 이미지 3종 | **Bazel** (rules_oci) | 베이스 이미지를 digest 로 한 곳에 고정 |
| 로컬 클러스터 | kind + kubectl | 클러스터 정의를 파일로 고정 |
| 진입점 | just | 세 툴체인의 명령을 한 곳에서 |

Bazel 을 세 패키지 전체로 넓히지 않은 것은 의도된 선택이다. backend·frontend 의
테스트 게이트를 Bazel 위에서 다시 만드는 비용이 얻는 것보다 크다.

## 구조

```
deploy/
├── BUILD.bazel        # oci_image 3종 (backend · frontend · ai)
├── kind/cluster.yaml  # 노드 · 포트 매핑
├── k8s/               # 매니페스트 (postgres · redis · backend · ai · frontend)
└── bin/               # 멱등 스크립트 — just 가 호출, 셸에서도 그대로 실행 가능
```

## 알아둘 것

**backend 이미지는 Gradle 산출물에 의존한다.** `just backend-build` 가 bootJar 를
만들고 `deploy/bin/stage.sh` 가 `deploy/artifacts/backend/app.jar` 로 복사한다.
jar 가 없으면 `just images` 가 거기서 멈춘다 — jar 없는 이미지를 만들어
파드가 기동 직후 죽는 것보다 낫다.

**frontend 이미지는 정적 스텁이다.** 지금 `frontend/web/` 은 통합 테스트용
`index.html` 하나다. 실제 웹 번들로 바꾸려면 `just frontend-web-export`.
React Native 앱 자체는 시뮬레이터/실기에서 돈다 — 컨테이너 대상이 아니다.

**ai 이미지에는 의존성 레이어가 없다.** `ai/main.py` 가 stdlib 만 쓰는 스텁이라
그렇다. 실제 C1(LLM Gateway)·C2(Solver)가 anthropic·ortools 를 쓰기 시작하면
`deploy/BUILD.bazel` 에 의존성 레이어를 하나 더 얹어야 한다. 테스트 쪽은
이미 실제 의존성을 쓴다(`bazel test //ai:pytest`).

**베이스 이미지는 digest 로 고정돼 있다.** 갱신하려면 `just images-digest` 의
출력을 `MODULE.bazel` 에 옮겨 적는다. arm64 는 `linux/arm64/v8` 로 적어야 한다
— variant 를 빼면 rules_oci 가 매니페스트를 못 찾는다.

**JDK 25 자동탐지.** Homebrew 로 깐 JDK 는 Gradle 이 못 찾는다. `just` 가
`/opt/homebrew/opt/openjdk@25/...` 를 기본으로 넘기며, 다른 위치면
`TRIPPILOT_JDK25` 환경변수로 지정한다.
