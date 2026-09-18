# syntax=docker/dockerfile:1
# TripPilot Backend — 멀티스테이지(빌드→런타임). 호스트 툴체인과 무관하게 컨테이너 안에서 빌드.

# ── 에이전트 스테이지 (OTel Java 에이전트 내려받기) ─────────────
# 트레이스는 에이전트가 담당한다(TRIP-218). 버전은 backend/gradle/libs.versions.toml 의
# opentelemetryInstrumentation 과 **같은 릴리스 트레인**이어야 한다 — logback appender 와
# 에이전트 버전이 어긋나면 로그에 trace_id 가 실리지 않아 로그↔트레이스 상관이 끊긴다.
FROM eclipse-temurin:25-jdk AS agent
ARG OTEL_AGENT_VERSION=2.30.0
ARG OTEL_AGENT_SHA256=9d6bc2ad8dd8fb7f730984988e57b8ac0a82d81c7b3b8ae795378718733a509d
ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${OTEL_AGENT_VERSION}/opentelemetry-javaagent.jar /otel/agent.jar
# 체크섬 검증 — 릴리스 태그는 옮겨질 수 있고, 에이전트는 우리 JVM 안에서 바이트코드를 고쳐 쓴다.
RUN echo "${OTEL_AGENT_SHA256}  /otel/agent.jar" | sha256sum -c -

# ── 빌드 스테이지 (JDK 25 툴체인) ───────────────────────────────
FROM eclipse-temurin:25-jdk AS build
WORKDIR /src
# 래퍼·빌드 설정 먼저 복사(레이어 캐시 최적화 — 소스만 바뀌면 의존성 재다운로드 회피)
COPY gradlew settings.gradle.kts build.gradle.kts gradle.properties ./
COPY gradle ./gradle
RUN chmod +x gradlew
# 모듈 소스
COPY app ./app
COPY common ./common
COPY modules ./modules
# 실행 가능 부트 jar 생성 (plain jar 는 app 모듈에서 비활성화 → 산출 jar 는 하나)
#
# 캐시 마운트: 11개 모듈을 컨테이너 안에서 전부 빌드하므로 의존성 재다운로드 비용이 크다.
# 마운트된 디렉터리는 이미지 레이어에 남지 않아 최종 이미지 크기에는 영향이 없다.
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew :app:bootJar --no-daemon

# ── 런타임 스테이지 (경량 JRE) ─────────────────────────────────
FROM eclipse-temurin:25-jre AS runtime
# 헬스체크용 curl
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
# 비루트 실행. UID 를 숫자로 고정하는 이유: k8s 의 runAsNonRoot 는 이름이 아니라 숫자 UID 로만
# 검증할 수 있다. deploy/k8s/backend/deployment.yaml 의 runAsUser/runAsGroup 과 같은 값이어야 한다.
RUN groupadd --gid 1001 app && useradd --uid 1001 --gid 1001 --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
# --chmod 을 명시한다. ADD 로 받은 파일은 0600 root:root 이고 COPY 는 그 권한을 그대로 옮기므로,
# 비루트(1001)로 실행하면 JVM 이 에이전트 jar 를 열지 못하고
# "Error opening zip file or JAR manifest missing" 으로 기동 자체가 실패한다(실측).
COPY --from=build --chmod=0644 /src/app/build/libs/*.jar /app/app.jar
COPY --from=agent --chmod=0644 /otel/agent.jar /app/otel-agent.jar

# 관측성 안전 기본값(TRIP-218). ConfigMap 에서도 같은 값을 주지만 여기에도 둔다 —
# 이 두 개를 빠뜨리면 **조용히** 잘못 동작하기 때문이다.
#   LOGBACK_APPENDER_ENABLED=false : 에이전트가 root 로거에 appender 를 자동 부착하면
#     MaskingAppender 를 우회한 원문(토큰·이메일)이 그대로 수집기로 나간다. 보안 사고.
#   LOGBACK_MDC_ENABLED=false      : 에이전트의 logback MDC 계측이 ILoggingEvent 에 넣는 가상 필드가
#     주입되지 않아 첫 로그 호출에서 NoSuchFieldError 로 기동이 실패한다(에이전트 2.14.0 에서 실측).
#     로그 경로는 우리 appender 가 소유하므로 에이전트는 logback 을 건드리지 않는 편이 설계상 맞다.
#   METRICS_EXPORTER=otlp          : 메트릭도 에이전트가 내보낸다. Micrometer 의 OTLP push 는
#     에이전트가 붙으면 **조용히 유실**돼 SigNoz 에 아무것도 적재되지 않는다(실측).
#     이중 발행은 application.yml 의 management.otlp.metrics.export.enabled 기본값 false 로 막는다.
ENV OTEL_INSTRUMENTATION_LOGBACK_APPENDER_ENABLED=false \
    OTEL_INSTRUMENTATION_LOGBACK_MDC_ENABLED=false \
    OTEL_METRICS_EXPORTER=otlp \
    OTEL_TRACES_EXPORTER=otlp \
    OTEL_LOGS_EXPORTER=otlp \
    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
    OTEL_SERVICE_NAME=trippilot-backend

USER 1001:1001
EXPOSE 8080
# -javaagent 는 JAVA_TOOL_OPTIONS 가 아니라 ENTRYPOINT 에 직접 둔다.
# 환경변수 경로는 다른 값에 덮여 조용히 사라질 수 있고, 그러면 트레이스만 없는 채로 정상 기동한다.
ENTRYPOINT ["java", "-javaagent:/app/otel-agent.jar", "-jar", "/app/app.jar"]
