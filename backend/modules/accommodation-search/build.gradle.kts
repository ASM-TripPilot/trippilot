// modules/accommodation-search — C3: 숙소 탐색(정적 콘텐츠 + 최저가 스냅숏). 타 modules/* 직접 참조 금지(R1).
// 1차: 외부 콘텐츠는 스텁 어댑터. Redis 캐시·Resilience4j 서킷은 실 벤더 어댑터 단계(TRIP-175 범위 밖).
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))            // R5: 에러 계약
    implementation(project(":modules:place-data"))     // R1: 지역명→표준코드 조회 — place-data.api(RegionLookupFacade)만 사용
    implementation(libs.spring.boot.starter.data.jpa)  // out/persistence — stay_price_snapshot
    implementation(libs.spring.boot.starter.web)        // adapter/in/web 컨트롤러
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
}
