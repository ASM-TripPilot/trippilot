// modules/weather-context — C11 날씨·맥락(U4 정본 §4).
// "하나의 외부 API = 하나의 소유 모듈 = 하나의 어댑터 포트" — 기상 조회를 여기서만 한다.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
}
