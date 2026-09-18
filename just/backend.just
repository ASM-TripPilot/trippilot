# backend — Gradle 이 소유한다.
#
# Bazel 로 옮기지 않은 이유: Konsist·ArchUnit 아키텍처 규칙, Kotest PBT,
# Flyway 마이그레이션, Testcontainers 통합 테스트가 모두 Gradle 위에 얹혀
# 게이트로 동작하고 있다. 툴체인을 바꾸면 그 게이트를 전부 다시 만들어야 한다.

# Homebrew 로 깐 JDK 25 는 Gradle 자동탐지 경로에 없어서 그냥 두면
# "Cannot find a Java installation ... languageVersion=25" 로 죽는다.
jdk25 := env_var_or_default('TRIPPILOT_JDK25', '/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home')
gradle_flags := if path_exists(jdk25) == "true" { "-Porg.gradle.java.installations.paths=" + jdk25 } else { "" }

# 실행 가능 부트 jar 생성 후 Bazel 이 집어갈 자리로 복사
backend-build:
    cd backend && ./gradlew :app:bootJar {{ gradle_flags }}
    ./deploy/bin/stage.sh

# 전체 모듈 테스트 (Testcontainers 사용 — Docker 필요)
backend-test:
    cd backend && ./gradlew test {{ gradle_flags }}

# 단일 테스트: just backend-test-one com.trippilot.app.SomeTest
backend-test-one FQCN:
    cd backend && ./gradlew test --tests "{{ FQCN }}" {{ gradle_flags }}

backend-clean:
    cd backend && ./gradlew clean {{ gradle_flags }}
    rm -rf deploy/artifacts/backend
