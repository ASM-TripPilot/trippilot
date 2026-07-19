// modules/profile — M2: Profile·PreferenceSet·닉네임. 타 modules/* 직접 참조 금지(R1). 구현은 TRIP-156~157.
// kotlin-spring: @Component/@Repository/@Service open(프록시). kotlin-jpa: @Entity open·no-arg.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))            // R5: 에러 계약
    implementation(libs.spring.boot.starter.data.jpa)  // out/persistence
    implementation(libs.spring.boot.starter.web)        // adapter/in/web 컨트롤러
    implementation(libs.spring.boot.starter.validation) // 요청 @Valid
    implementation(libs.jackson.module.kotlin)          // PUT 부분수정 tri-state 파싱(JsonNode)
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
}
