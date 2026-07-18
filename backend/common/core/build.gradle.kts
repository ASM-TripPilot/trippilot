// common/core — 도메인 이벤트 계약·트랜잭셔널 아웃박스·공통 타입(Result·에러).
// 프로덕션 의존 없음(플랫폼 최하위). 테스트만 test-support(하네스) 재사용.
dependencies {
    testImplementation(project(":common:test-support"))
}
