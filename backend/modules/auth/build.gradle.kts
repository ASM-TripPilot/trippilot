// modules/auth — M1: Account·SocialIdentity·Consent·Location·RefreshSession·Deletion.
// 타 modules/* 직접 참조 금지(R1). 구현은 TRIP-151~155.
// kotlin-spring: @Component/@Repository/@Service 등을 open 으로(CGLIB 프록시 요구).
// kotlin-jpa: @Entity 등을 open·no-arg 로 (JPA 요구). BOM은 platform 으로 버전 해석.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))            // R5: 이벤트·에러 계약
    implementation(libs.spring.boot.starter.data.jpa)  // out/persistence
    implementation(libs.spring.boot.starter.web)        // adapter/in/web 컨트롤러
    implementation(libs.jackson.module.kotlin)          // 외부 응답 JsonNode 파싱
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
}
