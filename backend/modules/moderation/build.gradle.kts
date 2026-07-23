// modules/moderation — C3: BannedWordDictionary·TextModerationFacade(profile·후속 UGC 재사용, R1 api 노출).
// kotlin-spring: @Service/@Repository open(프록시). kotlin-jpa: @Entity open·no-arg.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))            // R5: 에러 계약
    implementation(libs.spring.boot.starter.data.jpa)  // banned_word_dictionary 영속
    implementation(libs.jackson.module.kotlin)          // entries jsonb 파싱
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
}
