# 로컬 Kubernetes 구동

backend · frontend · ai · PostgreSQL · Redis 를 로컬 kind 클러스터 하나에서 함께 띄우고,
로그·메트릭·트레이스를 SigNoz 에서 본다.

빌드·테스트 진입점은 `just`, 컨테이너 이미지와 ai 패키지는 `Bazel` 이 소유한다.

> 사전 준비: Docker Desktop · kind · kubectl · helm · foundryctl · bazelisk · just · JDK 25.
> 설치 절차는 [docs/installs/k8s_install.md](../docs/installs/k8s_install.md) ·
> [docs/installs/signoz_install.md](../docs/installs/signoz_install.md).
> `just doctor` 로 무엇이 빠졌는지 한 번에 확인할 수 있다.

## 한 줄로 띄우기

```bash
just up      # 클러스터+SigNoz 생성 → backend 빌드 → 이미지 3종 → 배포
```

**최초 1회 SigNoz 관리자 계정을 만들어야 한다.** 계정(=조직)이 없으면 collector 가
파이프라인 설정을 받지 못해 **OTLP 수신기 자체가 열리지 않는다.** 앱 쪽에는
`Connection refused` 로 보인다. http://localhost:8083 에서 만든다
(비밀번호: 12자 이상 + 대문자 + 소문자 + 숫자 + 기호).

```bash
just health            # 네 서비스 응답 확인
just smoke             # 텔레메트리를 만들 트래픽 발생 (마스킹 프로브 포함)
just verify-telemetry  # SigNoz 에 실제로 적재됐는지 ClickHouse 직접 조회
just down              # 클러스터 삭제 (데이터·텔레메트리 포함)
```

| 서비스 | 주소 |
|---|---|
| frontend | http://localhost:8080 |
| backend | http://localhost:8081/actuator/health |
| ai | http://localhost:8082/health |
| SigNoz UI | http://localhost:8083 |
| postgres | 클러스터 밖으로 열지 않음 — `just db-shell` |

포트는 `deploy/kind/cluster.yaml` 의 NodePort → hostPort 매핑으로 고정돼 있다.
`kubectl port-forward` 는 쓰지 않는다 — 이미 열린 매핑에 리스너를 겹치면 어느 쪽이
응답할지 OS 바인딩 우선순위에 달리게 되고, 터미널도 붙잡고 있어야 한다.

> **NodePort 와 hostPort 는 한 쌍이다.** 한쪽만 바꾸면 접근이 끊긴다. 그리고
> `extraPortMappings` 는 **클러스터 생성 시점에만** 정할 수 있어, 포트를 추가하려면
> 클러스터를 다시 만들어야 한다.

## 자주 쓰는 것

```bash
just status                    # 파드·서비스 상태
just logs trippilot-backend    # 로그 따라가기 (ai · frontend 도 같은 방식)
just update                    # 이미지 새로 만들고 파드만 교체 (클러스터 유지)
just db-shell                  # psql 접속
just db-migrations             # 적용된 Flyway 마이그레이션 확인
just signoz                    # SigNoz UI 주소·필터 안내
just watch                     # 적재 상황 실시간
just undeploy                  # 매니페스트만 제거 (클러스터·SigNoz 유지)
```

## 누가 무엇을 소유하는가

| 대상 | 소유 도구 | 이유 |
|---|---|---|
| backend 빌드·테스트 | Gradle | Konsist·ArchUnit·Kotest PBT·Flyway·Testcontainers 가 모두 Gradle 게이트 위에 있다 |
| frontend 빌드·테스트 | pnpm | Expo prebuild·Metro·Jest |
| ai 빌드·테스트 | **Bazel** (rules_python) | 의존성이 pyproject 하나로 끝나고 재구축할 게이트가 없었다 |
| 컨테이너 이미지 3종 | **Bazel** (rules_oci) | 베이스 이미지와 OTel 에이전트를 digest 로 한 곳에 고정 |
| 로컬 클러스터 | kind + kubectl | 클러스터 정의를 파일로 고정 |
| 진입점 | just | 세 툴체인의 명령을 한 곳에서 |

Bazel 을 세 패키지 전체로 넓히지 않은 것은 의도된 선택이다. backend·frontend 의
테스트 게이트를 Bazel 위에서 다시 만드는 비용이 얻는 것보다 크다.

## 구조

```
deploy/
├── BUILD.bazel        # oci_image 3종 + OTel 에이전트 레이어
├── kind/cluster.yaml  # 노드 · 포트 매핑 (30080·30081·30082·30083)
├── k8s/
│   ├── backend/       # namespace · configmap · deployment · service (+ backend 별칭)
│   ├── postgres/      # secret · configmap-init · statefulset · service
│   ├── redis/         # 조회 캐시 (비영속)
│   ├── ai/            # 스텁 서비스
│   ├── frontend/      # nginx 정적 + /api 프록시
│   └── signoz/        # UI NodePort 30083
└── bin/               # 멱등 스크립트 — just 가 호출, 셸에서도 그대로 실행 가능
    ├── _common.sh     # 공통 변수·컨텍스트 가드
    ├── cluster-up.sh  # 클러스터 생성 + SigNoz 설치
    ├── stage.sh       # Gradle bootJar → Bazel 이 집어갈 자리로 복사
    ├── images.sh      # Bazel 이미지 빌드 + Docker·kind 적재
    ├── deploy.sh      # postgres → backend → redis·ai·frontend
    └── down.sh        # 클러스터 삭제
```

## 관측성

애플리케이션은 OTLP 로 세 신호를 SigNoz 에 보낸다.

| 신호 | 담당 | 근거 |
|---|---|---|
| 로그 | logback OTLP appender (`MaskingAppender` 경유) **+ stdout JSON** | 마스킹을 우리가 소유해야 함 |
| 메트릭 | OTel Java 에이전트 | Micrometer OTLP push 는 에이전트와 공존 시 조용히 유실됨(실측) |
| 트레이스 | OTel Java 에이전트 | `opentelemetry-spring-boot-starter` 는 Boot 4 에서 컨텍스트가 깨짐 |

**에이전트는 Bazel 이 이미지에 넣는다.** `MODULE.bazel` 의 `otel_javaagent`(버전·sha256
고정) → `deploy/BUILD.bazel` 의 `otel_agent_layer` → entrypoint 의 `-javaagent`.
버전은 `backend/gradle/libs.versions.toml` 의 `opentelemetryInstrumentation` 과 **같은
릴리스 트레인**이어야 한다 — 어긋나면 로그에 trace_id 가 실리지 않아 로그↔트레이스
상관이 끊긴다.

### 빠뜨리면 조용히 잘못 동작하는 설정

`deploy/BUILD.bazel` 의 `env` 와 `deploy/k8s/backend/configmap.yaml` 에 같은 값이 있다.
두 곳에 두는 이유는 이미지를 열어보지 않아도 매니페스트만으로 "왜 이 설정인가"가
보여야 하기 때문이다.

| 설정 | 이유 |
|---|---|
| `OTEL_INSTRUMENTATION_LOGBACK_APPENDER_ENABLED=false` | 에이전트가 root 로거에 appender 를 자동 부착하면 `MaskingAppender` 를 우회한 **원문 토큰·이메일**이 수집기로 나간다. 보안 사고다 |
| `OTEL_INSTRUMENTATION_LOGBACK_MDC_ENABLED=false` | 에이전트의 logback MDC 계측이 넣는 가상 필드가 주입되지 않아 첫 로그에서 `NoSuchFieldError` 로 **기동 자체가 실패**한다(실측) |
| `OTEL_METRICS_EXPORTER=otlp` | 메트릭도 에이전트가 내보낸다. Micrometer 의 OTLP push 는 에이전트가 붙으면 오류 로그 하나 없이 유실된다(실측) |

`just verify-telemetry` 의 `unmasked_jwt` 가 0 이 아니면 사고다 — 원문 토큰이
수집기로 나갔다는 뜻이다.

## 알아둘 것

**backend 이미지는 Gradle 산출물에 의존한다.** `just backend-build` 가 bootJar 를
만들고 `deploy/bin/stage.sh` 가 `deploy/artifacts/backend/app.jar` 로 복사한다.
jar 가 없으면 `just images` 가 거기서 멈춘다 — jar 없는 이미지를 만들어 파드가
기동 직후 죽는 것보다 낫다.

**이미지는 `imagePullPolicy: Never` 다.** kind 노드는 호스트 Docker 와 별도의 이미지
스토어를 쓰고 레지스트리는 없다. `IfNotPresent` 로 두면 이미지가 없을 때 레지스트리로
나가 `ImagePullBackOff` 가 된다.

**frontend 이미지는 정적 스텁이다.** 지금 `frontend/web/` 은 통합 테스트용
`index.html` 하나다. 실제 웹 번들로 바꾸려면 `just frontend-web-export`.
React Native 앱 자체는 시뮬레이터/실기에서 돈다 — 컨테이너 대상이 아니다.
nginx 의 `/api` 프록시가 `backend` 라는 이름을 쓰므로(compose 와 공유), k8s 에는
`deploy/k8s/backend/service-alias.yaml` 로 같은 이름의 Service 를 하나 더 둔다.

**ai 이미지에는 의존성 레이어가 없다.** `ai/main.py` 가 stdlib 만 쓰는 스텁이라
그렇다. 실제 C1(LLM Gateway)·C2(Solver)가 anthropic·ortools 를 쓰기 시작하면
`deploy/BUILD.bazel` 에 의존성 레이어를 하나 더 얹어야 한다. 테스트 쪽은 이미 실제
의존성을 쓴다(`bazel test //ai:pytest`).

**베이스 이미지는 digest 로 고정돼 있다.** 갱신하려면 `just images-digest` 의 출력을
`MODULE.bazel` 에 옮겨 적는다. arm64 는 `linux/arm64/v8` 로 적어야 한다 — variant 를
빼면 rules_oci 가 매니페스트를 못 찾는다.

**JDK 25 자동탐지.** Homebrew 로 깐 JDK 는 Gradle 이 못 찾는다. `just` 가
`/opt/homebrew/opt/openjdk@25/...` 를 기본으로 넘기며, 다른 위치면 `TRIPPILOT_JDK25`
환경변수로 지정한다.
