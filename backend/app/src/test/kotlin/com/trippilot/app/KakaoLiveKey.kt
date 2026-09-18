package com.trippilot.app

/**
 * 카카오 라이브 테스트의 **키 게이트**.
 *
 * `LIVE_KAKAO=1` 만 보고 켜면, 키가 없는 사람에게는 스프링 컨텍스트가 기동 가드
 * (`RegionGeocodeModeAnnouncer`)에 막혀 **`Failed to load ApplicationContext` 만 보인다** —
 * 가드가 적어 둔 친절한 메시지("키가 비어 있습니다")는 중첩 `Caused by` 에 묻혀 안 보인다.
 * 그 화면은 "카카오가 안 된다"로 읽히지 "키가 없다"로는 안 읽힌다(실측 2026-09-18).
 *
 * 그래서 **키가 없으면 건너뛴다** — `LiveKmaWeatherIT` 가 이미 같은 규칙이다
 * (`LIVE_KMA == "1" && key.isNotBlank()`).
 *
 * ⚠ 건너뛴 것을 통과로 읽지 말 것. 실제로 돌았는지는 결과 XML 의 `skipped` 로 확인한다 —
 * 이 리포에서 "BUILD SUCCESSFUL 인데 한 건도 안 돌았다"를 실제로 겪었다.
 */
fun hasKakaoKey(): Boolean =
    !System.getenv("KAKAO_REST_KEY").isNullOrBlank() || !System.getenv("KAKAO_CLIENT_ID").isNullOrBlank()
