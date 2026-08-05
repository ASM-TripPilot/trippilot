// app — 유일한 Spring Boot 애플리케이션. 각 모듈을 스프링 컨텍스트에 조립한다(R4).
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependencyManagement)
}

dependencies {
    // 조립 대상: 공통 플랫폼 + U1 기능 모듈 (app → modules → common, R5)
    implementation(project(":common:core"))
    implementation(project(":common:security"))
    implementation(project(":modules:auth"))
    implementation(project(":modules:profile"))
    implementation(project(":modules:moderation"))
    implementation(project(":modules:accommodation-search"))
    implementation(project(":modules:saved-accommodation"))
    implementation(project(":modules:trip"))
    implementation(project(":modules:place-data"))
    implementation(project(":modules:itinerary-generation"))

    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.actuator)
    implementation(libs.spring.boot.starter.oauth2.resource.server) // 보안 필터체인(R6) — Bearer JWT 검증
    implementation(libs.spring.boot.starter.data.jpa)   // @EnableJpaRepositories·JPA autoconfig (jdbc 포함)
    implementation(libs.jackson.module.kotlin)
    implementation(libs.jackson.datatype.jsr310)
    implementation(libs.kotlin.reflect)
    implementation(libs.logstash.logback.encoder)
    implementation(libs.spring.boot.flyway)
    implementation(libs.flyway.core)
    implementation(libs.swagger.ui)                     // Swagger UI 정적 자산(/webjars/**)
    runtimeOnly(libs.flyway.database.postgresql)
    runtimeOnly(libs.postgresql)

    testImplementation(project(":common:test-support"))
    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.spring.boot.testcontainers)
    testImplementation(libs.testcontainers.postgresql)
    testImplementation(libs.testcontainers.junit.jupiter)
    testImplementation(libs.bundles.kotest)
    testImplementation(libs.mockk)
    testImplementation(libs.archunit.junit5)   // 아키텍처 경계 게이트(R1·R4·R5)
    testImplementation(libs.konsist)            // 소스 레벨 규칙(R2 domain 순수성)
}

// 실행은 bootJar(실행 가능 jar)만 사용 — plain jar 비활성화(Docker COPY 시 jar 하나로 고정)
tasks.named<Jar>("jar") { enabled = false }

// 설계-우선 스펙 단일 소스: docs/design/openapi.yaml 을 정적 리소스로 복사 → /openapi.yaml 서빙 + 계약 테스트가 읽음.
// (커밋된 중복 없음. 정본은 docs/design, 빌드 시 classpath 로 복사.)
tasks.named<Copy>("processResources") {
    from(rootProject.file("docs/design/openapi.yaml")) { into("static") }
}
