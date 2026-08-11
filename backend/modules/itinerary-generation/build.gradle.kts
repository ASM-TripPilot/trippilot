// modules/itinerary-generation — C8: AI 일정 생성 결과의 백엔드 도메인·영속·오케스트레이션.
// AI 솔버·오케스트레이션은 Python 서비스 소유; 백엔드는 ScheduleAgent 경계로 호출하고 결과를 소유·영속한다.
// TRIP-266: 스키마·도메인 토대(itinerary→day→slot). 타 modules/* 직접 참조 금지(R1).
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))            // R5: 에러 계약
    implementation(project(":modules:trip"))            // R1: trip.api(TripFacade)만 — 날짜·소유 조회
    implementation(project(":modules:profile"))         // R1: profile.api(PreferenceFacade)만 — 취향 7축·예산등급
    implementation(project(":modules:saved-accommodation")) // R1: saved-accommodation.api(BaseAnchorFacade)만 — 거점 좌표 앵커
    implementation(project(":modules:place-data"))      // R1: place-data.api(CandidatePoolPort)만 — Fake 에이전트가 실 ACTIVE 후보 emit
    implementation(libs.spring.boot.starter.data.jpa)  // out/persistence — itinerary/day/slot
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)        // adapter/in/web — 생성 API + RestClient(AI 경계 호출)
    implementation(libs.jackson3.module.kotlin)         // AI 경계 매퍼(Jackson 3 = SB4 기본) — 와이어 DTO 역직렬화
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
    testImplementation(libs.kotest.property)
    testImplementation(libs.jackson.module.kotlin)      // BE-1 계약 직렬화(snake_case) 왕복 테스트
    testImplementation(libs.jackson.datatype.jsr310)
}

// AI 경계 계약 정본(`ai/docs/openapi.json`)은 이 모듈 밖 — 리포 루트에 있다(AiBoundaryOpenApiTest, TRIP-334).
// 입력으로 선언하지 않으면 상대가 계약을 바꿔도 Gradle 이 테스트를 UP-TO-DATE 로 건너뛴다 —
// 로컬에서 게이트가 조용히 꺼진 채 초록이 된다(실측: 계약을 흔들어도 테스트가 아예 실행되지 않았다).
// `files` 라서 파일이 없어도 여기서 죽지 않는다 — 없다는 사실은 테스트가 제 메시지로 알린다.
tasks.test {
    inputs.files(rootProject.file("../ai/docs/openapi.json"))
        .withPropertyName("aiBoundaryContract")
        .withPathSensitivity(PathSensitivity.RELATIVE)
}
