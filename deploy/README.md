# 로컬 Kubernetes 배포 가이드

백엔드와 PostgreSQL을 로컬 **kind** 클러스터에 빌드·배포하고, 로그·메트릭·트레이스를 SigNoz에서 확인하는 방법입니다.

> 선행 조건: Docker, `kubectl`, `helm`, `kind`, `foundryctl`, JDK 25.
> 설치는 [../docs/installs/k8s_install.md](../docs/installs/k8s_install.md) 참조.

---

## 빠른 시작

`just`로 감싸 두었습니다. `just`만 치면 전체 목록이 나옵니다.

```bash
brew install just

just doctor        # 도구·클러스터·앱 상태 확인
just up            # 클러스터 생성 → 이미지 빌드 → 배포

# SigNoz 최초 설정 (중요 — 건너뛰면 수집이 안 됩니다. 아래 트러블슈팅 참조)
#   → http://localhost:8080 접속 후 관리자 계정 생성

just smoke             # 트래픽 발생
just verify-telemetry  # SigNoz 적재 확인
```

코드를 고친 뒤에는:

```bash
just update
```

<details>
<summary>원본 스크립트로 직접 실행하기</summary>

```bash
./deploy/bin/cluster-up.sh
./deploy/bin/build.sh
./deploy/bin/deploy.sh
./deploy/bin/update.sh
```

`justfile`은 이 스크립트들을 **대체하지 않고 감쌉니다.** 각 명령이 실제로 무엇을 하는지는
`cat justfile`로 확인하세요.
</details>

---

## 구성

```
deploy/
├── kind/cluster.yaml        클러스터 정의 (노드 수·포트 매핑)
├── k8s/
│   ├── backend/             백엔드 매니페스트
│   │   ├── namespace.yaml
│   │   ├── configmap.yaml   DB URL · OTLP 엔드포인트 · 에이전트 설정
│   │   ├── deployment.yaml  initContainer(DB 대기) + 앱
│   │   └── service.yaml     NodePort 30081 → 호스트 8081
│   ├── postgres/            PostgreSQL (앱이 Flyway 마이그레이션을 돌리므로 필수)
│   │   ├── secret.yaml          DB 자격증명 (로컬 전용)
│   │   ├── configmap-init.yaml  롤·스키마 부트스트랩 SQL
│   │   ├── statefulset.yaml
│   │   └── service.yaml         ClusterIP (클러스터 밖으로 열지 않음)
│   └── signoz/
│       └── ui-nodeport.yaml SigNoz UI NodePort 30080 → 호스트 8080
└── bin/
    ├── _common.sh           공통 변수·컨텍스트 가드
    ├── cluster-up.sh        클러스터 생성 + SigNoz 설치
    ├── build.sh             이미지 빌드 + kind 노드 적재
    ├── deploy.sh            PostgreSQL → 백엔드 순으로 적용 + 롤아웃 대기
    └── update.sh            빌드 + 롤링 재시작
```

---

## 스크립트

### `cluster-up.sh` — 클러스터 준비

kind 클러스터를 만들고 SigNoz를 설치합니다. **멱등**이라 이미 있으면 건너뜁니다.

완전히 새로 만들려면:

```bash
kind delete cluster --name trippilot
./deploy/bin/cluster-up.sh
```

### `build.sh` — 빌드 + 노드 적재

두 가지 일을 합니다.

1. `docker build` — `backend/Dockerfile` (멀티스테이지: JDK 25로 빌드 → JRE 25로 실행)
2. `kind load docker-image` — **이게 핵심입니다**

> **`kind load`가 왜 필요한가**
> kind 노드는 호스트 Docker와 **별도의 이미지 스토어**를 씁니다. `docker build`만 하면 노드에서는 그 이미지가 보이지 않아 파드가 `ErrImageNeverPull`로 멈춥니다. `kind load`가 이미지를 노드 안으로 복사합니다.

11개 모듈을 컨테이너 안에서 전부 빌드하므로 첫 빌드는 5분 이상 걸립니다. Dockerfile이 Gradle 캐시를 BuildKit 캐시 마운트에 두므로 두 번째부터는 훨씬 빠릅니다.

### `deploy.sh` — 배포

PostgreSQL을 먼저 세우고 기동을 기다린 뒤 백엔드를 적용합니다. 실패하면 파드 상태·`describe`·최근 로그를 함께 보여줍니다.

네임스페이스를 먼저 적용합니다 — `kubectl apply -f <디렉터리>`는 파일명 알파벳 순으로 처리해서, 그냥 두면 `configmap`·`deployment`가 `namespace`보다 먼저 적용돼 실패합니다.

### `update.sh` — 코드 변경 후 재배포

빌드 → 노드 적재 → `kubectl rollout restart`.

태그(`:dev`)는 그대로 둡니다. 태그가 같아도 `kind load`가 노드의 이미지를 교체했으므로 새 파드는 새 이미지를 씁니다. 태그를 매번 바꾸면 노드에 옛 이미지만 쌓입니다.

---

## 접근 방법

| 대상 | 방법 |
|---|---|
| 백엔드 API | `curl http://localhost:8081/...` — **port-forward 불필요** |
| SigNoz UI | http://localhost:8080 — **port-forward 불필요** |
| PostgreSQL | `just db-shell` (클러스터 밖으로 열려 있지 않음) |

둘 다 `Service`의 NodePort가 `kind/cluster.yaml`의 `extraPortMappings`로 호스트 포트에 연결돼 있기 때문입니다(백엔드 30081→8081, SigNoz 30080→8080).

> **두 값은 한 쌍입니다.** 한쪽만 바꾸면 접근이 끊깁니다. 그리고 `extraPortMappings`는 **클러스터 생성 시점에만** 정할 수 있어, 포트를 추가하려면 클러스터를 다시 만들어야 합니다.
>
> 이 매핑이 있으므로 `kubectl port-forward`로 8080을 또 열지 마세요. 같은 호스트 포트에 리스너가 둘 겹쳐 어느 쪽이 응답할지 OS 바인딩 우선순위에 달리게 됩니다.

### 확인용 엔드포인트

```bash
curl http://localhost:8081/actuator/health/liveness   # 프로세스 생존
curl http://localhost:8081/actuator/health/readiness  # 트래픽 수용 가능
curl http://localhost:8081/api/health                 # 앱 응답
curl http://localhost:8081/api/v1/terms               # 모듈 경유 조회
```

`/actuator/metrics` 등 나머지 actuator 엔드포인트는 Spring Security가 401로 막습니다 — 정상입니다.

---

## 관측성

애플리케이션은 OTLP로 세 신호를 SigNoz에 보냅니다.

| 신호 | 담당 | 근거 |
|---|---|---|
| 로그 | logback OTLP appender (`MaskingAppender` 경유) **+ stdout JSON** | 마스킹을 우리가 소유해야 함 |
| 메트릭 | OTel Java 에이전트 | Micrometer OTLP push는 에이전트와 공존 시 조용히 유실됨(실측) |
| 트레이스 | OTel Java 에이전트 | `opentelemetry-spring-boot-starter`는 Boot 4에서 컨텍스트가 깨짐 |

에이전트는 `backend/Dockerfile`이 이미지에 넣고 `ENTRYPOINT`의 `-javaagent`로 붙입니다.

### 반드시 유지해야 하는 에이전트 설정

`deploy/k8s/backend/configmap.yaml`과 `backend/Dockerfile`에 같은 값이 들어 있습니다. 셋 다 **빠뜨리면 조용히 잘못 동작**합니다.

| 설정 | 이유 |
|---|---|
| `OTEL_INSTRUMENTATION_LOGBACK_APPENDER_ENABLED=false` | 에이전트가 root 로거에 appender를 자동 부착하면 `MaskingAppender`를 우회한 **원문 토큰·이메일**이 수집기로 나갑니다. 보안 사고입니다. |
| `OTEL_INSTRUMENTATION_LOGBACK_MDC_ENABLED=false` | 에이전트 2.14.0에서 `ILoggingEvent` 가상 필드가 주입되지 않아 첫 로그 호출에서 `NoSuchFieldError`로 **기동 자체가 실패**합니다. |
| `OTEL_METRICS_EXPORTER=otlp` | 메트릭 소유권이 에이전트입니다. `none`으로 두면 메트릭이 하나도 적재되지 않습니다. |

엔드포인트는 실행 위치에 따라 다릅니다.

| 실행 위치 | `OTEL_EXPORTER_OTLP_ENDPOINT` | 설정 위치 |
|---|---|---|
| 클러스터 안(파드) | `http://signoz-ingester.signoz.svc.cluster.local:4318` | `k8s/backend/configmap.yaml` |
| 맥 로컬(`bootRun`) | `http://localhost:4318` + ingester port-forward | `application.yml` 기본값 |

SigNoz **Logs → Logs Explorer**에서:

```text
service.name = trippilot-backend
service.name = trippilot-backend AND severity_text = ERROR
```

### 적재 확인

UI를 거치지 않고 저장소를 직접 봅니다. "대시보드에 안 보인다"가 수집 실패인지 조회 조건 문제인지 가르는 것이 목적입니다.

```bash
just verify-telemetry
```

`unmasked_jwt`가 0이 아니면 **마스킹이 뚫린 것**이므로 사고로 다뤄야 합니다.

---

## 트러블슈팅

### SigNoz에 아무것도 안 들어옴 — 가장 흔한 원인

**SigNoz 관리자 계정을 아직 만들지 않은 경우입니다.**

계정(=조직)이 없으면 collector가 OpAMP로 파이프라인 설정을 받지 못해 **OTLP 수신기 자체가 열리지 않습니다.** 애플리케이션 쪽에는 `Connection refused`로 보입니다.

증상 확인:

```bash
kubectl logs -n signoz signoz-0 --tail=20 | grep "failed to find or create agent"
kubectl logs deployment/trippilot-backend -n trippilot --tail=20 | grep "Failed to export"
```

해결 — http://localhost:8080 에서 계정을 만듭니다.

| 응답 | 원인 | 해결 |
|---|---|---|
| `invalid_password` | **12자 이상 + 대문자 + 소문자 + 숫자 + 기호** 필요 | 정책을 만족하는 비밀번호 사용 |
| `self-registration is disabled` | 첫 계정이 이미 조직을 점유함 | 기존 계정으로 로그인하거나 아래처럼 재설치 |

> 로컬 전용 계정입니다. **실제로 쓰는 비밀번호를 재사용하지 마세요.**

계정 생성 후 30초 내에 collector가 설정을 받아 수집이 시작됩니다. 그래도 안 되면 `kubectl rollout restart deployment/signoz-ingester -n signoz`.

### 파드가 `CrashLoopBackOff` — 로그에 `NoSuchFieldError ... __opentelemetryVirtualField`

`OTEL_INSTRUMENTATION_LOGBACK_MDC_ENABLED=false`가 빠졌습니다. ConfigMap을 확인하세요.

이때 **진짜 원인이 가려집니다**. 로깅 자체가 깨지므로 Spring의 실패 보고도 함께 죽어, 원래의 기동 실패 이유가 보이지 않습니다. 원인을 보려면 에이전트를 잠시 떼고 띄우세요:

```bash
kubectl patch deployment trippilot-backend -n trippilot --type=json \
  -p '[{"op":"add","path":"/spec/template/spec/containers/0/command","value":["java","-jar","/app/app.jar"]}]'
# 확인이 끝나면 되돌리기
kubectl patch deployment trippilot-backend -n trippilot --type=json \
  -p '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]'
```

### 모든 HTTP 응답이 200인데 본문이 비어 있음

OTel 에이전트 **2.14.0**의 증상입니다. 상태 코드와 헤더는 정상인데 본문이 0바이트가 됩니다. `backend/Dockerfile`의 `OTEL_AGENT_VERSION`이 2.30.0 이상인지 확인하세요.

### 메트릭만 안 들어옴

`OTEL_METRICS_EXPORTER`가 `none`이면 그렇습니다. `otlp`여야 합니다.
에이전트가 붙은 상태에서 Micrometer의 OTLP push(`management.otlp.metrics.export`)는 **오류 로그 하나 없이 유실**되므로, 그쪽을 켜서 해결하려 하지 마세요.

### 파드가 `ErrImageNeverPull`

이미지를 노드에 적재하지 않았습니다. `./deploy/bin/build.sh`를 실행하세요.

### 파드가 `CreateContainerConfigError`

`container has runAsNonRoot and image has non-numeric user`라면, Dockerfile의 `USER`가 **숫자 UID**여야 합니다. kubelet은 이름으로는 non-root 여부를 검증하지 못합니다.

### `Error opening zip file or JAR manifest missing: /app/otel-agent.jar`

`ADD`로 받은 파일은 `0600 root:root`이고 `COPY`가 그 권한을 그대로 옮깁니다. 비루트(1001)로 실행하면 읽지 못합니다. `COPY --chmod=0644`로 받아야 합니다.

### DB 초기화 SQL을 고쳤는데 반영되지 않음

`/docker-entrypoint-initdb.d`의 스크립트는 **데이터 디렉터리가 비어 있을 때만** 실행됩니다. PVC를 지워야 합니다.

```bash
just db-reset      # ⚠️ DB 데이터가 전부 사라집니다
```

### 컨텍스트 오류로 스크립트가 멈춤

```
✗ 현재 컨텍스트가 'xxx' 입니다. 이 스크립트는 'kind-trippilot' 에서만 동작합니다.
```

의도된 차단입니다. EKS 컨텍스트에서 로컬 배포 스크립트가 도는 사고를 막습니다.

```bash
kubectl config use-context kind-trippilot
```

### SigNoz 완전 초기화

```bash
helm uninstall signoz -n signoz
kubectl delete pvc --all -n signoz
kubectl delete namespace signoz

# Terminating 에서 멈추면 — ClickHouse CR 의 finalizer 를 처리할 오퍼레이터가
# 이미 지워져 무한 대기한다. finalizer 를 직접 비운다.
kubectl patch clickhouseinstallation signoz-telemetrystore-clickhouse -n signoz \
  --type=merge -p '{"metadata":{"finalizers":[]}}'

just cluster-up
```

> 수집한 로그·트레이스·대시보드가 **전부 사라집니다.** 되돌릴 수 없습니다.

---

## 정리

```bash
just undeploy       # 앱만 제거
just cluster-down   # 클러스터 통째로 (SigNoz 수집 데이터까지 사라짐)
```
