# SigNoz 설치 및 로그 검색 가이드

이 문서는 TripPilot 로컬 개발환경에 **SigNoz**(오픈소스 관측 플랫폼)를 설치하고, 수집된 로그를 검색하는 방법을 설명합니다.

SigNoz는 OpenTelemetry 기반으로 **로그·트레이스·메트릭을 한 곳에서** 다루는 도구입니다. 백엔드(Spring Boot)와 AI 레이어(Python)에서 나오는 로그를 서비스 단위로 묶어 보고, 트레이스와 연결해 원인을 추적하는 것이 목적입니다.

> **선행 조건**: [k8s_install.md](k8s_install.md)의 Docker Desktop 설치가 끝나 있어야 합니다.

---

## 목차

- [SigNoz 설치 및 로그 검색 가이드](#signoz-설치-및-로그-검색-가이드)
  - [목차](#목차)
  - [0. 시작 전 확인](#0-시작-전-확인)
  - [1. 설치 방식 선택](#1-설치-방식-선택)
  - [2. Docker 단독 설치 (로컬 개발 권장)](#2-docker-단독-설치-로컬-개발-권장)
  - [3. Kubernetes 설치](#3-kubernetes-설치)
  - [4. 설치 확인](#4-설치-확인)
  - [5. 애플리케이션 연결 (OpenTelemetry)](#5-애플리케이션-연결-opentelemetry)
  - [6. 로그 검색하기](#6-로그-검색하기)
  - [7. 자주 쓰는 로그 검색 예시](#7-자주-쓰는-로그-검색-예시)
  - [8. 로그를 잘 남기는 규칙](#8-로그를-잘-남기는-규칙)
  - [9. 중지·제거](#9-중지제거)
  - [10. 문제 해결](#10-문제-해결)
  - [11. 공식 문서](#11-공식-문서)

---

## 0. 시작 전 확인

### 검증 상태

| 항목 | 상태 |
|---|---|
| Docker 단독 설치 (§2) | **실제 설치로 검증** (foundryctl v0.2.17 / macOS 26.5 / Apple Silicon) |
| 컨테이너 구성·포트·헬스체크 (§4) | **실측 확인** |
| 로그 검색 UI·연산자 (§6) | 공식 문서 확인 |
| Kubernetes 설치 (§3) | casting 형식만 확인, **클러스터 배포 미수행** |

### 리소스 요구사항

SigNoz는 **ClickHouse + ClickHouse Keeper + PostgreSQL**을 포함해 가볍지 않습니다. 컨테이너 6개가 상주합니다.

| 항목 | 요구사항 |
|---|---|
| Docker 할당 메모리 | **최소 4GB** (SigNoz 몫) |
| 사용 포트 | `8080` (UI), `4317` (OTLP gRPC), `4318` (OTLP HTTP) |

> **주의 — 8GB MacBook 사용자**
> [k8s_install.md](k8s_install.md) §6은 8GB 장비에 Docker 메모리 **4GB**를 권장합니다. 그 상태로 SigNoz를 띄우면 **SigNoz 하나가 할당량을 전부 소진**해 프로젝트 컨테이너를 함께 돌릴 수 없습니다.
>
> 8GB 장비라면 다음 중 하나를 택하세요.
>
> - SigNoz를 쓸 때만 Docker 메모리를 6GB로 올리고, 프로젝트 앱은 로컬(`./gradlew bootRun`)에서 실행
> - SigNoz는 팀 공용 인스턴스를 사용하고 로컬에는 설치하지 않음

포트 충돌을 미리 확인하세요. `8080`은 애플리케이션 기본 포트와 겹치기 쉽습니다.

```bash
lsof -i :8080 -i :4317 -i :4318
```

출력이 있으면 해당 프로세스를 종료하거나 포트를 조정해야 합니다.

---

## 1. 설치 방식 선택

SigNoz는 **Foundry**(`foundryctl`)라는 CLI로 설치합니다. `casting.yaml` 설정 파일 하나에 "무엇을 어디에 배포할지"를 선언하면 Foundry가 배포 파일을 생성하고 실행까지 처리합니다.

> **중요**
> 예전 방식인 `install.sh` 스크립트와 저장소에 번들된 `deploy/` 하위 docker-compose 파일은 **SigNoz v0.130.0부터 폐기(deprecated)되어 더 이상 유지보수되지 않습니다.** 인터넷에 남아 있는 "git clone 후 docker compose up" 안내는 모두 구버전입니다.

지원 조합은 CLI가 직접 알려줍니다.

```bash
foundryctl catalog --format text
```

```text
┌────────────┬───────────┬──────────┬──────────────────────┐
│    MODE    │  FLAVOR   │ PLATFORM │       EXAMPLE        │
├────────────┼───────────┼──────────┼──────────────────────┤
│ docker     │ compose   │          │ docker/compose       │
│ docker     │ swarm     │          │ docker/swarm         │
│ kubernetes │ helm      │          │ kubernetes/helm      │
│ kubernetes │ kustomize │          │ kubernetes/kustomize │
│ systemd    │ binary    │          │ systemd/binary       │
│ ec2        │ terraform │ ecs      │ ecs/ec2/terraform    │
└────────────┴───────────┴──────────┴──────────────────────┘
```

로컬 개발에서는 **Docker 단독(`docker`/`compose`) 방식을 권장**합니다. 로컬 Kubernetes에 올리면 ClickHouse까지 클러스터 리소스를 잡아먹어 정작 개발 중인 애플리케이션이 밀립니다. 관측 도구는 애플리케이션 옆에서 조용히 돌면 충분합니다.

### foundryctl 하위 명령

| 명령 | 역할 |
|---|---|
| `catalog` | 지원되는 배포 조합 출력 |
| `gen examples` | 지원 조합별 **정답 예시 파일** 생성 (`docs/examples/` 하위) |
| `gauge` | 배포에 필요한 도구가 설치돼 있는지 검증 |
| `forge` | casting을 읽어 배포 파일 생성 → `pours/`에 출력 |
| `cast` | `gauge` + `forge` + 배포를 한 번에 실행 |

> **설정이 막히면 `foundryctl gen examples`를 먼저 돌리세요.** 웹 문서보다 정확합니다 — 실제로 공식 문서 페이지의 예시와 CLI가 요구하는 스키마가 달랐습니다(§2.3 참고).

---

## 2. Docker 단독 설치 (로컬 개발 권장)

### 2.1 foundryctl 설치

```bash
curl -fsSL https://signoz.io/foundry.sh | bash
```

> 파이프로 바로 실행하는 것이 꺼려지면 내려받아 확인 후 실행하세요.
>
> ```bash
> curl -fsSL https://signoz.io/foundry.sh -o /tmp/foundry.sh
> less /tmp/foundry.sh
> bash /tmp/foundry.sh
> ```

바이너리는 **`~/.local/bin/foundryctl`**에 설치됩니다. 이 경로가 `PATH`에 없으면 명령을 찾지 못합니다.

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

설치 확인:

```bash
foundryctl version --format text
```

### 2.2 작업 디렉터리 준비

SigNoz 설정과 생성 파일은 **저장소 밖**에 두세요. `pours/` 산출물이 저장소를 오염시킵니다.

```bash
mkdir -p ~/signoz && cd ~/signoz
```

### 2.3 casting.yaml 작성

```bash
cat > casting.yaml <<'YAML'
apiVersion: v1alpha1
kind: Installation
metadata:
  name: signoz
spec:
  deployment:
    flavor: compose
    mode: docker
YAML
```

> **⚠️ 흔한 실수 — `deployment:` 레벨 누락**
> `flavor`·`mode`는 반드시 **`spec.deployment` 아래**에 와야 합니다. 공식 문서 웹페이지에는 이 중간 레벨이 빠진 예시가 실려 있어, 그대로 복사하면 다음 오류가 납니다.
>
> ```json
> { "exception": { "type": "unsupported",
>   "message": "deployment '{Platform: Mode: Flavor: _:{}}' is not supported" } }
> ```
>
> `Platform`·`Mode`·`Flavor`가 **전부 빈 값**으로 찍히면 이 문제입니다. 값이 틀린 게 아니라 위치가 틀린 것입니다.

### 2.4 사전 검증 후 배포

```bash
foundryctl gauge -f casting.yaml --format text
```

출력이 없으면 통과입니다. 이어서 배포합니다.

```bash
foundryctl cast -f casting.yaml --format text
```

이미지 내려받기와 ClickHouse 마이그레이션까지 **수 분**이 걸립니다. 중간에 끊지 마세요.

완료 후 디렉터리에는 다음이 생깁니다.

```text
~/signoz/
├── casting.yaml            # 내가 작성한 선언 파일
├── casting.yaml.lock       # Foundry가 고정한 버전 정보
└── pours/
    └── deployment/
        ├── compose.yaml    # 생성된 Docker Compose 파일
        └── ingester/
            ├── ingester.yaml
            └── opamp.yaml
```

> 파일명이 `docker-compose.yaml`이 아니라 **`compose.yaml`**입니다.

### 2.5 접속

```text
http://localhost:8080/
```

최초 접속 시 관리자 계정을 생성합니다. 로컬 전용 계정이므로 **실제로 쓰는 비밀번호를 재사용하지 마세요.**

---

## 3. Kubernetes 설치

로컬 Docker Desktop Kubernetes보다는 **팀 공용 클러스터·EKS에 올릴 때** 사용하는 경로입니다.

> **미검증**: 아래 casting 형식은 `foundryctl gen examples`가 생성한 공식 예시와 동일함을 확인했으나, **실제 클러스터 배포는 수행하지 않았습니다.** 네임스페이스·릴리스명·`port-forward` 대상은 배포 후 `pours/deployment/`에 생성된 매니페스트에서 확인하세요.

```bash
cat > casting-k8s.yaml <<'YAML'
apiVersion: v1alpha1
kind: Installation
metadata:
  name: signoz
spec:
  deployment:
    flavor: helm
    mode: kubernetes
YAML
```

```bash
foundryctl gauge -f casting-k8s.yaml --format text   # helm·kubectl 검증
foundryctl forge -f casting-k8s.yaml --format text   # Helm values 생성 (배포 안 함)
```

`forge`까지만 돌리면 `pours/deployment/values.yaml`이 생성됩니다. **배포 전에 이 파일을 반드시 열어 확인하세요.** 확인 후 배포합니다.

```bash
foundryctl cast -f casting-k8s.yaml --format text
```

> Kubernetes(helm) 조합은 Docker 조합과 구성 요소가 다릅니다. Docker는 **ClickHouse Keeper**를 쓰는 반면, Helm values 기본값은 **Zookeeper**(`signoz/zookeeper:3.7.1`)를 사용합니다.

EKS에 올릴 때는 [k8s_install.md](k8s_install.md) §20의 컨텍스트 확인 습관을 반드시 지키세요.

```bash
kubectl config current-context
```

Kustomize·ArgoCD 경로가 필요하면 `flavor: kustomize`로 바꾸면 됩니다.

---

## 4. 설치 확인

### 컨테이너 상태

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -iE 'signoz|NAMES'
```

정상 설치 시 다음 6개가 뜹니다.

| 컨테이너 | 역할 | 포트 |
|---|---|---|
| `signoz-signoz-0` | UI + 쿼리 서비스 | `8080` |
| `signoz-ingester-1` | OTel Collector (수집 입구) | `4317`, `4318` |
| `signoz-telemetrystore-clickhouse-0-0` | ClickHouse — 로그·트레이스 저장 | 내부 |
| `signoz-telemetrykeeper-clickhousekeeper-0` | ClickHouse Keeper — 코디네이션 | 내부 |
| `signoz-metastore-postgres-0` | PostgreSQL — 대시보드·설정 등 메타데이터 | 내부 |
| `signoz-telemetrystore-migrator` | 스키마 마이그레이션 | 내부 |

> **`signoz-telemetrystore-clickhouse-user-scripts`가 `Exited`인 것은 정상입니다.** 히스토그램 함수 바이너리를 내려받는 **1회성 초기화 작업**이라 끝나면 종료됩니다.

### 헬스체크

```bash
curl -s http://localhost:8080/api/v1/health
```

```json
{"status":"ok"}
```

### UI 응답

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/
```

`200`이면 정상입니다.

---

## 5. 애플리케이션 연결 (OpenTelemetry)

SigNoz는 스스로 로그를 만들지 않습니다. **애플리케이션이 OTLP로 보내야** 화면에 나타납니다.

| 프로토콜 | 주소 |
|---|---|
| OTLP gRPC | `http://localhost:4317` |
| OTLP HTTP | `http://localhost:4318` |

### 5.1 백엔드 (Spring Boot + Kotlin)

OpenTelemetry Java 에이전트를 붙이는 방식이 코드 변경 없이 가장 빠릅니다.

```bash
mkdir -p ~/otel && curl -L -o ~/otel/opentelemetry-javaagent.jar \
  https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar
```

```bash
java -javaagent:$HOME/otel/opentelemetry-javaagent.jar \
  -Dotel.service.name=trippilot-backend \
  -Dotel.exporter.otlp.endpoint=http://localhost:4317 \
  -Dotel.logs.exporter=otlp \
  -Dotel.traces.exporter=otlp \
  -Dotel.metrics.exporter=otlp \
  -jar app/build/libs/<APP_JAR>.jar
```

Gradle `bootRun`으로 띄운다면 환경변수로 전달할 수 있습니다.

```bash
JAVA_TOOL_OPTIONS="-javaagent:$HOME/otel/opentelemetry-javaagent.jar" \
OTEL_SERVICE_NAME=trippilot-backend \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
OTEL_LOGS_EXPORTER=otlp \
./gradlew :app:bootRun
```

> `otel.service.name`은 **로그 검색의 1차 필터 키**가 됩니다. 모듈별로 다르게 주면 화면에서 섞이지 않습니다.

### 5.2 AI 레이어 (Python)

```bash
pip install opentelemetry-distro opentelemetry-exporter-otlp
opentelemetry-bootstrap --action=install
```

```bash
OTEL_SERVICE_NAME=trippilot-ai-gateway \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
OTEL_LOGS_EXPORTER=otlp \
opentelemetry-instrument python main.py
```

### 5.3 서비스 이름 규칙 (제안)

로그가 쌓이기 시작하면 이름 규칙이 없을 때 검색이 급격히 힘들어집니다. 팀 합의 전이라면 아래를 기본으로 쓰세요.

| 대상 | `service.name` |
|---|---|
| 백엔드 모놀리스 | `trippilot-backend` |
| AI 게이트웨이 | `trippilot-ai-gateway` |
| 솔버 엔진 | `trippilot-solver` |

---

## 6. 로그 검색하기

좌측 메뉴에서 **Logs → Logs Explorer**로 들어갑니다.

### 6.1 화면 구성

| 영역 | 설명 |
|---|---|
| 좌측 **Quick Filters** | 자주 쓰는 속성(서비스·심각도 등)을 클릭만으로 필터링 |
| 상단 **필터 표현식 바** | 검색 조건을 직접 입력 |
| 중앙 **결과 영역** | List / Time Series / Table 3가지 보기 모드 |

### 6.2 보기 모드

| 모드 | 용도 |
|---|---|
| **List** | 개별 로그를 시간순으로 확인. 상단에 심각도별 빈도 차트 표시 |
| **Time Series** | 조건에 맞는 로그 **개수의 시간 추이**를 그래프로 확인 |
| **Table** | 그룹별 집계 결과를 표로 확인 |

장애를 볼 때는 **Time Series로 급증 시점을 찾고 → List로 그 구간의 실제 로그를 읽는** 순서가 빠릅니다.

### 6.3 검색 연산자

| 분류 | 연산자 |
|---|---|
| 비교 | `=`, `!=` |
| 목록 | `IN`, `NOT IN` |
| 텍스트 | `CONTAINS` |
| 존재 | `EXISTS` |

여러 조건은 `AND` / `OR`로 조합합니다.

### 6.4 로그 상세 보기

로그 한 줄을 클릭하면 상세 패널이 열리고 4개 탭이 제공됩니다.

| 탭 | 내용 |
|---|---|
| **Overview** | 로그 본문과 속성(attributes) |
| **JSON** | 원본 JSON 전체 |
| **Context** | **그 로그의 앞뒤 로그** — 원인 추적에 가장 유용 |
| **Metrics** | 해당 시점의 인프라 지표와 연결 |

에러 하나를 붙잡았다면 **Context 탭**부터 여세요. 직전에 무슨 일이 있었는지가 대부분 거기 있습니다.

### 6.5 Query Builder — 집계

단순 검색을 넘어 집계가 필요할 때 사용합니다.

```text
count()  avg()  sum()  p50()  p90()  p95()  p99()
```

`group by`와 조합해 "서비스별 에러 건수", "엔드포인트별 p95" 같은 질문에 답할 수 있습니다.

### 6.6 Saved Views

자주 쓰는 필터 조합은 이름을 붙여 저장해 두면 클릭 한 번으로 불러올 수 있습니다. 팀에서 반복 조회하는 조건(예: `AI 폴백 발생`)은 저장해 공유하세요.

---

## 7. 자주 쓰는 로그 검색 예시

속성 이름은 실제로 애플리케이션이 보내는 키에 맞춰 조정하세요.

**특정 서비스의 에러만**

```text
service.name = trippilot-backend AND severity_text = ERROR
```

**여러 서비스를 한 번에**

```text
service.name IN (trippilot-backend, trippilot-ai-gateway)
```

**본문에 특정 문구가 포함된 로그**

```text
body CONTAINS "CandidatePool"
```

**특정 속성이 존재하는 로그만**

```text
trace_id EXISTS
```

**에러이면서 특정 문구를 포함**

```text
severity_text = ERROR AND body CONTAINS "timeout"
```

**특정 요청 하나를 추적** — 트레이스와 로그를 잇는 가장 강력한 방법입니다.

```text
trace_id = <TRACE_ID>
```

> 트레이스 화면에서 느린 요청을 찾은 뒤 그 `trace_id`로 로그를 걸면, **그 요청 하나가 남긴 로그만** 시간순으로 모입니다. 로그를 grep으로 뒤지는 것과 비교가 되지 않습니다.

### 이 프로젝트에서 유용한 조회

AI 레이어의 불변식(INV-1~INV-4) 위반과 폴백은 반드시 관측 대상입니다.

```text
service.name = trippilot-ai-gateway AND body CONTAINS "fallback"
```

```text
service.name = trippilot-solver AND severity_text = ERROR
```

> `INV-4`는 "AI 실패 시 결정적 폴백, 무음 실패 금지"를 요구합니다. 위 조회에서 **아무것도 안 나오는데 사용자 불만은 있는 상황**이 가장 위험합니다 — 폴백이 로그를 남기지 않고 있다는 뜻이기 때문입니다.

---

## 8. 로그를 잘 남기는 규칙

검색은 남긴 만큼만 됩니다.

- **구조화 로그를 쓸 것** — 문자열을 이어 붙이지 말고 키·값 속성으로 남깁니다. `CONTAINS` 전문 검색보다 `=` 속성 필터가 훨씬 빠르고 정확합니다.
- **`trace_id`가 함께 나가게 할 것** — OTel 에이전트를 붙이면 대체로 자동 주입됩니다. 이것이 없으면 로그와 트레이스가 끊깁니다.
- **심각도를 정확히 쓸 것** — 전부 INFO로 남기면 `severity_text` 필터가 무력화됩니다.
- **민감 정보를 남기지 말 것** — SigNoz에 들어간 로그도 [k8s_install.md](k8s_install.md) §22의 민감 정보 규칙을 그대로 따릅니다. 토큰·비밀번호·좌표 원본·개인정보를 로그 본문에 넣지 마세요. 한번 수집되면 ClickHouse에 그대로 남습니다.

---

## 9. 중지·제거

모든 명령은 생성된 compose 파일 위치에서 실행합니다.

```bash
cd ~/signoz/pours/deployment
```

### 중지 (컨테이너 유지)

```bash
docker compose -f compose.yaml stop
```

### 재시작

```bash
docker compose -f compose.yaml start
```

### 컨테이너 제거 (데이터 유지)

```bash
docker compose -f compose.yaml down
```

### 데이터까지 완전 삭제

```bash
docker compose -f compose.yaml down -v
```

> **주의**
> `-v`는 볼륨을 지웁니다. **수집한 로그·트레이스·대시보드 설정이 모두 사라집니다.** 되돌릴 수 없습니다.

### 디스크 회수

ClickHouse는 디스크를 빠르게 먹습니다. 주기적으로 확인하세요.

```bash
docker system df
```

---

## 10. 문제 해결

### `foundryctl: command not found`

`~/.local/bin`이 `PATH`에 없는 경우입니다.

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

---

### `deployment '{Platform: Mode: Flavor: _:{}}' is not supported`

`casting.yaml`에서 **`spec.deployment` 레벨이 빠진** 경우입니다. §2.3의 형식과 대조하세요.

정답 예시를 직접 뽑아 비교할 수도 있습니다.

```bash
foundryctl gen examples
cat docs/examples/docker/compose/casting.yaml
```

---

### 포트 8080이 이미 사용 중

```bash
lsof -i :8080
```

애플리케이션이 쓰고 있다면 둘 중 하나를 다른 포트로 옮겨야 합니다. 개발 중인 앱 쪽을 옮기는 편이 대개 간단합니다.

---

### UI는 뜨는데 로그가 하나도 없음

수집 경로가 끊긴 것입니다. 순서대로 확인하세요.

1. 애플리케이션에 OTel 에이전트가 실제로 붙었는지 (기동 로그에 OTel 배너가 뜨는지)
2. `OTEL_EXPORTER_OTLP_ENDPOINT`가 `http://localhost:4317`로 설정됐는지
3. 로그 익스포터가 켜져 있는지 (`OTEL_LOGS_EXPORTER=otlp`) — **트레이스만 켜고 로그를 빼먹는 실수가 가장 흔합니다**
4. 컨테이너에서 앱을 돌린다면 `localhost`가 아니라 `host.docker.internal`이어야 합니다

수집기 자체 로그도 확인해 보세요.

```bash
docker logs signoz-ingester-1 --tail 50
```

---

### 컨테이너가 계속 재시작됨

대부분 **메모리 부족**입니다. ClickHouse가 먼저 죽습니다.

```bash
docker stats --no-stream
```

Docker Desktop의 할당 메모리를 늘리세요 ([k8s_install.md](k8s_install.md) §6).

---

### `signoz-telemetrystore-clickhouse-user-scripts`가 Exited 상태

**정상입니다.** 1회성 초기화 컨테이너라 작업이 끝나면 종료됩니다. 재시작할 필요 없습니다.

---

### 오래된 설치 방법을 안내하는 블로그를 따라 했다면

`git clone` 후 `deploy/` 아래 docker-compose를 띄우는 방식은 **v0.130.0부터 폐기**됐습니다. 그렇게 띄운 스택은 정리하고 §2부터 다시 진행하세요.

---

## 11. 공식 문서

- [SigNoz 문서 홈](https://signoz.io/docs/)
- [Docker 단독 설치](https://signoz.io/docs/install/docker/)
- [Kubernetes 설치](https://signoz.io/docs/install/kubernetes/)
- [Helm 직접 배포](https://signoz.io/docs/install/kubernetes/others/)
- [로그 사용 가이드](https://signoz.io/docs/userguide/logs/)
- [Foundry 저장소](https://github.com/SigNoz/foundry) · [Foundry CLI 레퍼런스](https://github.com/SigNoz/foundry/blob/main/docs/reference/cli.md)
- [Foundry 소개 글](https://signoz.io/blog/introducing-signoz-foundry/)

> 웹 문서와 CLI가 어긋나는 경우가 실제로 있었습니다(§2.3). **`foundryctl catalog`·`foundryctl gen examples`가 가장 정확한 기준**이며, 확인한 내용은 이 문서에 반영해 주세요.
