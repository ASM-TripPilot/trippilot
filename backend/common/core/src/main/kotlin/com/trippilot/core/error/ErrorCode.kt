package com.trippilot.core.error

/**
 * 도메인 에러 코드 — HTTP status 와 분리된 클라이언트 분기용 식별자(U1-내부아키텍처 §4.2).
 * 문자열 값이 에러 봉투의 `error.code` 로 노출된다.
 */
enum class ErrorCode {
    VALIDATION_ERROR,
    AUTHENTICATION_REQUIRED,
    PERMISSION_DENIED,
    RESOURCE_NOT_FOUND,
    CONFLICT,
    UPSTREAM_UNAVAILABLE,
    RATE_LIMITED,
    INTERNAL,

    // 도메인별 코드(전역 카탈로그) — 상태는 대응 DomainException 타입이 결정
    SOCIAL_AUTH_FAILED,
    /** 그 제공자를 **아직** 지원하지 않는다(501). 자격 증명 실패와 구분해야 화면이 "준비 중"을 말할 수 있다. */
    PROVIDER_NOT_SUPPORTED,
    SOCIAL_EMAIL_CONFLICT,
    REFRESH_TOKEN_INVALID,   // 리프레시 토큰 미존재·만료·폐기(401)
    REFRESH_REUSE_DETECTED,  // 소진된 리프레시 토큰 재제시 → 체인 폐기(401, INV-R2)
    AGE_REQUIREMENT_NOT_MET, // 만 14세 미만 가입 차단(422 — BR-U0-05 "미충족 422, 계정 미생성")
    NICKNAME_TAKEN,          // 닉네임 대소문자 무시 중복(409, INV-P1)
    GENERATION_IN_PROGRESS,  // 다른 여행의 일정을 생성 중(409, TRIP-403)
    GENERATION_SUPERSEDED,   // 취소·대체된 생성 요청의 뒤늦은 1일차 — 반영 안 함(409, TRIP-1058)
    GENERATION_DAILY_LIMIT,  // 계정의 하루 AI 일정 생성 횟수 소진(429, TRIP-1314) — 내일 풀린다, 재시도로는 안 풀린다
    AUTOMATION_DISABLED,     // 서버 킬 스위치로 자동 기록이 꺼져 있다(409, U10 REL-U10-06) — 기기는 무장을 풀고 강등한다
    LOCATION_CONSENT_REQUIRED, // 위치 동의(L2, 경로 기록은 L3 까지)가 없다(409, U10 BR-U10-45) — 기기는 강등한다
    TURN_IN_PROGRESS,        // 도우미 턴이 **이미 기록돼 처리 중**이다(429, TRIP-1401) — 같은 clientTurnId 로 다시 보내면 그 답을 받는다
    MODERATION_UNAVAILABLE,  // 활성 금칙어 사전 미로드 — 검증 차단(503, fail-closed INV-B2)
    VISIT_ALREADY_RECORDED,  // 재생한 방문 기록이 **이미 서버에 같은 상태로 있다**(409, BR-U5-20)
    VISIT_CONFLICT,          // 재생한 방문 기록이 서버와 **다른 상태**다 — 사용자 해소 필요(409, BR-U5-21)
    VISIT_HAS_MEDIA,         // 사진·메모가 붙은 방문의 자동 도착은 되돌리지 않는다 — 먼저 지우라고 안내(409, U10 BR-U10-31)
    VISIT_NOT_AUTO,
    VISIT_AUTO_SUPPRESSED,   // 그날 자동 기록을 되돌린 슬롯이라 자동 쓰기를 받지 않는다(409, U10 §5.2) — 기기는 버린다(사용자 해소 아님)          // 되돌릴 자동 기록이 없다 — 수동 기록은 되돌리기 대상이 아니다(409, U10 BR-U10-31)
    // 도우미 제안 적용 거절(409, U8 BR-U8-32) — 앱이 카드를 어떻게 바꿀지가 셋으로 갈린다. 이름은 프론트 계약 그대로다.
    STALE,                   // 제안을 만든 뒤 일정이 바뀌었다 — 저장하지 않았다. 다시 제안받는다
    EXPIRED,                 // 제안이 만료됐다
    NOT_APPLICABLE,          // 위반이 있거나, 취소·실패로 끝났거나, 다른 적용이 저장 중인 제안이다
}
