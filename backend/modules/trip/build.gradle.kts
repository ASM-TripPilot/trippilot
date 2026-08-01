// modules/trip — C6: 여행 생성·목적지. 타 modules/* 직접 참조 금지(R1).
// 필수방문지(must_visit)는 place-data(POI/스냅숏) 의존이라 Sprint 3. 상태전이·이벤트도 후속.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))
    implementation(project(":modules:place-data"))     // R1: 필수방문지 스냅숏 동결 — place-data.api(PoiSnapshotFacade)만 사용
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
    testImplementation(libs.kotest.property)   // 상태전이·nightsSum PBT
}
