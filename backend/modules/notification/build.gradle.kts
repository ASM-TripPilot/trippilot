// modules/notification — C14 알림함·리마인드 스케줄(U6 · TRIP-547).
// 아웃박스 구독자와 시각 폴링을 여기서 소유한다. 발행측(U1·U3·U4·U5) 코드는 건드리지 않는다 —
// 구독만으로 붙는 것이 이 모듈이 U6 에서 가장 먼저 서는 이유다.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))
    implementation(project(":modules:trip"))   // R1: 여행 소유자·기간 조회만 — trip.api(TripOwnerFacade)
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)
    // 아웃박스 payload(JSON 문자열)를 읽는다. 트리로만 읽으므로 Kotlin 모듈은 필요 없다.
    implementation(libs.jackson.module.kotlin)
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
}
