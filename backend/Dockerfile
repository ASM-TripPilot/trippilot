# syntax=docker/dockerfile:1
# TripPilot Backend — 멀티스테이지(빌드→런타임). 호스트 툴체인과 무관하게 컨테이너 안에서 빌드.

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
RUN ./gradlew :app:bootJar --no-daemon

# ── 런타임 스테이지 (경량 JRE) ─────────────────────────────────
FROM eclipse-temurin:25-jre AS runtime
# 헬스체크용 curl
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/app/build/libs/*.jar /app/app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
