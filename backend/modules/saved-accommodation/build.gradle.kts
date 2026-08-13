// modules/saved-accommodation — C4: 저장/등록 숙소·거점. 타 modules/* 직접 참조 금지(R1).
// 지오코딩은 place-data(C7 MapPlacePort 소유)에 위임 — 이 모듈은 카카오를 직접 잡지 않는다.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))            // R5: 에러 계약
    implementation(project(":modules:trip"))           // R1: 거점 배정 — trip.api(TripFacade)만 사용
    implementation(project(":modules:place-data"))     // R1: 등록 지오코딩 — place-data.api(MapPlaceSearchFacade)만 사용
    implementation(libs.spring.boot.starter.data.jpa)  // out/persistence — saved_stay·base_assignment
    implementation(libs.spring.boot.starter.web)        // adapter/in/web
    implementation(libs.spring.boot.starter.validation) // 요청 @Valid
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
    testImplementation(libs.kotest.property)            // 커버리지 리졸버 PBT-U1-2
}
