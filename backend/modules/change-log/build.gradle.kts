// modules/change-log — 변경 이력(changelog 계층, US-PLANB-09 · TRIP-275).
// 편집·Plan-B·어시스턴트가 만든 변경을 append-only 로 쌓고 타임라인으로 돌려준다.
// 별도 모듈인 이유: 앞으로 Plan-B·회고가 쓰는 이력이라, 일정 생성 모듈에 두면 그쪽이 여기에 의존하게 된다.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))
    implementation(project(":modules:trip"))   // R1: 소유 검증만 — trip.api(TripFacade)
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
}
