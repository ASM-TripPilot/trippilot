package com.trippilot.app.web

/**
 * 서비스 경계(`/internal`) 테스트용 토큰. `@TestPropertySource` 가 컴파일 상수를 요구하므로
 * 값을 여기 한 곳에 두고 각 IT 이 같은 값을 주입한다 — 두 벌로 두면 조용히 어긋난다.
 */
const val SERVICE_TOKEN: String = "test-service-token"
