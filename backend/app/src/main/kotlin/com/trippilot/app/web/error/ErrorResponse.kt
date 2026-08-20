package com.trippilot.app.web.error

import com.fasterxml.jackson.annotation.JsonInclude

/**
 * 실패 응답 봉투(U1-내부아키텍처 §4.1) — 성공(2xx)은 래퍼 없이 리소스 본문 그대로.
 * ```json
 * { "error": { "code": "NICKNAME_TAKEN", "message": "...", "traceId": "...", "fields": [ ... ] } }
 * ```
 */
data class ErrorResponse(
    val error: Body,
) {
    data class Body(
        val code: String,
        val message: String,
        val traceId: String?,
        /** VALIDATION_ERROR 에만 존재. */
        val fields: List<Field>? = null,
        /**
         * SOCIAL_EMAIL_CONFLICT 에만 존재(TRIP-211 · BR-U0-04 · INV-A3) — 같은 이메일로 이미
         * 가입된 기존 제공자를 클라이언트가 **계약 필드로** 읽어 "그 방법으로 로그인해 주세요"를
         * 안내한다. message 문자열 파싱에 의존하면 안내가 서버 문구 릴리즈에 묶인다.
         *
         * 값은 소문자 코드(`kakao`·`naver`·`google`·`apple`) — 기계 코드에서 한글 표시명으로의
         * 변환은 프론트가 소유한다(TRIP-182 결정 · frontend-components.md 「문구 소유자」).
         *
         * `fields` 가 VALIDATION_ERROR 에만 실리는 것과 같은 방식이되, **null 이면 아예 직렬화되지
         * 않는다**(@JsonInclude NON_NULL) — 다른 409(닉네임 중복 등)의 응답 형태를 바꾸지 않기 위함.
         */
        @get:JsonInclude(JsonInclude.Include.NON_NULL)
        val existingProvider: String? = null,
        /**
         * GENERATION_IN_PROGRESS 에만 존재(TRIP-403) — **지금 생성 중인 여행**의 식별자.
         *
         * 거절 사유만 주면 사용자는 무엇이 끝나기를 기다려야 하는지 모른다. 화면이 이 값으로
         * 그 여행으로 이동시킬 수 있다. `existingProvider` 와 같은 방식이다 — 코드별 타입 필드,
         * null 이면 미직렬화.
         */
        @get:JsonInclude(JsonInclude.Include.NON_NULL)
        val activeTripId: String? = null,
    )

    data class Field(
        val field: String,
        val reason: String,
    )
}
