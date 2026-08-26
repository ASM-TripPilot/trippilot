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
        /**
         * VISIT_ALREADY_RECORDED · VISIT_CONFLICT 에만 존재(TRIP-546 · BR-U5-20·21) —
         * 서버에 이미 있는 방문 기록의 식별자.
         *
         * 오프라인 큐 재생에서 **409 는 실패가 아니다.** 원하던 상태가 이미 서버에 있으면 클라이언트는
         * 그 항목을 `SYNCED` 로 수렴시키고, 다르면 해소 화면으로 간다 — 그 분기의 근거가 `code` 이고,
         * 어느 기록을 두고 하는 말인지가 이 값이다.
         *
         * ⚠ [existingProvider]·[activeTripId] 에 이어 **세 번째 사례**다. 그 주석은 "세 번째면
         * 일반화한다"고 적어 뒀지만 여기서는 따르지 않았다 — 일반화의 실체가 free-form object 인데,
         * 그건 그 주석이 막으려던 바로 그것이다(openapi 가 계약 노릇을 못 하게 된다).
         * 코드별 타입 필드를 유지하는 편이 계약을 지킨다.
         */
        @get:JsonInclude(JsonInclude.Include.NON_NULL)
        val visitCheckId: String? = null,
        /**
         * VISIT_ALREADY_RECORDED · VISIT_CONFLICT 에만 존재 — 서버 기록의 `updated_at`(BR-U5-22).
         * 충돌 판정의 기준값이라, 클라이언트가 이것을 받아 다음 재생의 `expectedUpdatedAt` 으로 쓴다.
         */
        @get:JsonInclude(JsonInclude.Include.NON_NULL)
        val serverUpdatedAt: String? = null,
    )

    data class Field(
        val field: String,
        val reason: String,
    )
}
