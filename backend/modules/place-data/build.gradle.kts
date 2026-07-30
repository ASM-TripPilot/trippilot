// modules/place-data — C7: POI 정본·표준화·수집 게이트(INV-1)·RAG 후보풀. 타 modules/* 직접 참조 금지(R1).
// U1 소속(2026-07-23 C7 U3→U1). 1차: 지도/장소 API는 스텁 어댑터(MapPlacePort). 실 벤더(카카오 로컬 등)는 이후.
// INV-1 소유자: closed-set 게이트 PBT(미통과 0)가 blocking.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))            // R5: 에러 계약
    implementation(libs.spring.boot.starter.data.jpa)  // out/persistence — poi
    implementation(libs.spring.boot.starter.web)        // adapter/in/web — 탐색 조회
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
    testImplementation(libs.kotest.property)            // closed-set 수집 게이트 PBT(INV-1)
}
