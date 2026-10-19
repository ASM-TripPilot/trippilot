// modules/planb-detection — C9 감지·억제(U4 정본 `construction/u4-in-trip-planb/`).
// 재계획(C10)과 나눈 이유: 여기는 "알릴지"를, 저기는 "무엇으로 바꿀지"를 정한다.
// 실패 모드가 달라(허위 알림 vs 잘못된 확정) 한 모듈에 두면 한쪽 변경이 다른 쪽을 흔든다.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))
    implementation(project(":modules:trip"))                   // R1: 소유·구간 검증 — trip.api
    implementation(project(":modules:itinerary-generation"))   // R1: 남은 슬롯 판정 — itinerarygeneration.api
    implementation(project(":modules:weather-context"))        // R1: 강수확률 조회 — weathercontext.api(ContextFacade)
    implementation(project(":modules:place-data"))             // R1: 폐업 판정 — placedata.api(PoiStatusFacade)만. place-data 는 core 에만 의존해 순환 없음
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.jackson.module.kotlin)   // 아웃박스 payload 트리 읽기(재계획 적용 소비) — notification·archive 와 같은 관례
    implementation(libs.jackson3.module.kotlin)  // AI 기회 경계 매퍼(Jackson 3 = SB4 기본) — 없으면 와이어 DTO 가 예외 없이 빈 값이 된다
    implementation(libs.shedlock.spring)         // 상황 감시 스윕 단일 실행 락(@SchedulerLock) — U10 지연 스캔도 같은 줄이다
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
    testImplementation(libs.kotest.property)
}

// AI 경계 계약 정본(`ai/docs/openapi.json`)은 이 모듈 밖 — 리포 루트에 있다(OpportunityBoundaryOpenApiTest).
// 입력으로 선언하지 않으면 상대가 계약을 바꿔도 Gradle 이 테스트를 UP-TO-DATE 로 건너뛴다(회고·일정 경계와 같은 이유).
tasks.test {
    inputs.files(rootProject.file("../ai/docs/openapi.json"))
}
