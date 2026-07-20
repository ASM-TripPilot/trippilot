// common/test-support — 테스트 하네스(TRIP-149).
// 각 모듈이 testImplementation(project(":common:test-support")) 로 재사용.
// 테스트 라이브러리를 api 로 노출해 소비 모듈 테스트 클래스패스에 전이한다.
// BOM 은 api(platform(...)) 로 내보내 버전 제약이 소비 모듈까지 전이되게 한다
// (io.spring.dependency-management 플러그인은 전이 안 됨).
dependencies {
    api(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    api(libs.spring.boot.starter.test)      // spring-test(@DynamicPropertySource) + JUnit5
    api(libs.testcontainers.postgresql)     // 싱글톤 PG 컨테이너
    api(libs.flyway.core)                    // 통합 스펙에서 마이그레이션
    api(libs.postgresql)                     // 부트스트랩 JDBC 드라이버
    api(libs.bundles.kotest)                 // runner + assertions + property(PBT)
    api(libs.mockk)
}
