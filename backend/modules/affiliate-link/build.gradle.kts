// modules/affiliate-link — 제휴 링크(C5, 제휴링크-연동-설계.md 칸 1 · BR-U1-29~32).
// 아웃바운드를 서버로 승격한다: 클릭을 적고 302 로 보낸다. OTA 계약 전이라 목적지는 웹검색 폴백뿐이고
// (BR-U1-31 이 명시 허용하는 우회), 실 벤더 어댑터(칸 3)가 오면 서버 변경만으로 목적지가 바뀐다.
// 별도 모듈인 이유: 포스트백 수신·벤더 어댑터·숙소 매핑(칸 2·3)이 여기로 자란다 — 탐색 모듈에 두면
// 검색이 제휴 사정에 끌려간다.
plugins {
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:${libs.versions.springBoot.get()}"))

    implementation(project(":common:core"))
    implementation(project(":modules:accommodation-search"))   // R1: 숙소 이름 조회만 — api(StayLookupFacade)
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.kotlin.reflect)

    testImplementation(project(":common:test-support"))
}
