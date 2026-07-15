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

    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.actuator)
    implementation(libs.jackson.module.kotlin)
    implementation(libs.kotlin.reflect)

    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.bundles.kotest)
    testImplementation(libs.mockk)
}
