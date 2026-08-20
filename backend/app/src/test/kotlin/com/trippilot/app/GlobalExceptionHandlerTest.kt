package com.trippilot.app

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.app.web.CorrelationIdFilter
import com.trippilot.app.web.error.GlobalExceptionHandler
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.RateLimited
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.core.error.ValidationFailed
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.junit.jupiter.api.AfterEach
import java.util.UUID
import org.springframework.http.HttpStatus
import org.junit.jupiter.api.Test
import org.slf4j.MDC

class GlobalExceptionHandlerTest {

    private val handler = GlobalExceptionHandler()

    @AfterEach
    fun cleanup() = MDC.clear()

    @Test
    fun `도메인 예외를 상태·코드·traceId 봉투로 매핑한다`() {
        MDC.put(CorrelationIdFilter.MDC_KEY, "trace-1")
        val res = handler.handleDomain(ResourceNotFound("계정 없음"))

        res.statusCode.value() shouldBe 404
        res.body!!.error.code shouldBe "RESOURCE_NOT_FOUND"
        res.body!!.error.traceId shouldBe "trace-1"
    }

    @Test
    fun `ValidationFailed 는 fields 를 포함한다`() {
        val res = handler.handleDomain(ValidationFailed(listOf(FieldError("nickname", "2~20자"))))

        res.statusCode.value() shouldBe 400
        res.body!!.error.code shouldBe "VALIDATION_ERROR"
        res.body!!.error.fields!!.single().field shouldBe "nickname"
    }

    @Test
    fun `RateLimited 는 429 + Retry-After 헤더를 준다`() {
        val res = handler.handleDomain(RateLimited(30))

        res.statusCode.value() shouldBe 429
        res.headers.getFirst("Retry-After") shouldBe "30"
    }

    @Test
    fun `UpstreamUnavailable 는 503 으로 매핑된다`() {
        val res = handler.handleDomain(UpstreamUnavailable(source = "kakao", fallbackApplied = false))

        res.statusCode.value() shouldBe 503
        res.body!!.error.code shouldBe "UPSTREAM_UNAVAILABLE"
    }

    @Test
    fun `미처리 예외는 INTERNAL 봉투로 침묵없이 반환하고 내부정보를 숨긴다`() {
        val res = handler.handleUnexpected(RuntimeException("boom-secret-detail"))

        res.statusCode.value() shouldBe 500
        res.body!!.error.code shouldBe "INTERNAL"
        res.body!!.error.message shouldNotContain "boom-secret-detail"
    }

    // ── TRIP-211 · 소셜 이메일 충돌에만 existingProvider 를 싣는다 (BR-U0-04 · INV-A3) ──

    @Test
    fun `SOCIAL_EMAIL_CONFLICT 는 기존 provider 를 소문자 코드로 계약 필드에 싣는다`() {
        val res = handler.handleDomain(
            ConflictDetected(
                current = listOf("KAKAO"),
                message = "이미 카카오(으)로 가입된 이메일이에요. 해당 방법으로 로그인해 주세요.",
                errorCode = ErrorCode.SOCIAL_EMAIL_CONFLICT,
            ),
        )

        res.statusCode.value() shouldBe 409
        res.body!!.error.code shouldBe "SOCIAL_EMAIL_CONFLICT"
        // 기계 코드 → 한글 표시명 변환은 프론트가 소유한다(TRIP-182 결정). 서버는 코드만 준다.
        res.body!!.error.existingProvider shouldBe "kakao"
    }

    @Test
    fun `제공자가 둘 이상이면 대표 1개만 준다 - 전체 나열은 message 소관이다`() {
        val res = handler.handleDomain(
            ConflictDetected(
                current = listOf("GOOGLE", "KAKAO"),
                message = "이미 구글, 카카오(으)로 가입된 이메일이에요.",
                errorCode = ErrorCode.SOCIAL_EMAIL_CONFLICT,
            ),
        )

        res.body!!.error.existingProvider shouldBe "google"
    }

    @Test
    fun `다른 409 는 existingProvider 가 null 이라 응답 형태가 그대로다`() {
        val res = handler.handleDomain(
            ConflictDetected(current = "ACTIVE", errorCode = ErrorCode.NICKNAME_TAKEN),
        )

        res.statusCode.value() shouldBe 409
        res.body!!.error.code shouldBe "NICKNAME_TAKEN"
        // current 가 List 가 아닌 호출자(계정 상태 enum 등)도 있다 — 캐스팅 실패로 500 이 나면 안 된다.
        res.body!!.error.existingProvider shouldBe null
    }

    @Test
    fun `null 인 existingProvider 는 JSON 에 아예 나타나지 않는다`() {
        // 계약 검사 — 필드를 추가해도 **다른 에러의 응답 형태는 불변**이어야 한다(회귀 금지).
        // 이 리포는 Jackson 기본 포함 정책(ALWAYS)이라, 프로퍼티 수준 NON_NULL 이 없으면
        // 모든 에러 본문에 "existingProvider": null 이 새로 생긴다.
        val mapper = ObjectMapper()

        val conflict = mapper.writeValueAsString(
            handler.handleDomain(
                ConflictDetected(
                    current = listOf("NAVER"),
                    errorCode = ErrorCode.SOCIAL_EMAIL_CONFLICT,
                ),
            ).body,
        )
        val notFound = mapper.writeValueAsString(handler.handleDomain(ResourceNotFound("없음")).body)

        conflict shouldContain "\"existingProvider\":\"naver\""
        notFound shouldNotContain "existingProvider"
    }
    /**
     * **진행 중인 여행이 계약 필드로 실린다**(TRIP-403).
     *
     * `ConflictDetected.current` 는 봉투에 자동으로 실리지 않는다 — errorCode 로 좁혀 꺼내는 코드가
     * 있어야 한다. 그것을 빠뜨리면 409 는 나가는데 **어느 여행인지가 통째로 빠져** 화면이 안내를 못 한다.
     */
    @Test
    fun `생성 충돌 409 는 진행 중인 여행을 계약 필드로 싣는다`() {
        val running = UUID.randomUUID()

        val res = handler.handleDomain(
            ConflictDetected(
                current = running,
                errorCode = ErrorCode.GENERATION_IN_PROGRESS,
                message = "다른 여행의 일정을 만들고 있어요.",
            ),
        )

        res.statusCode shouldBe HttpStatus.CONFLICT
        res.body!!.error.code shouldBe "GENERATION_IN_PROGRESS"
        res.body!!.error.activeTripId shouldBe running.toString()
    }

    /** 다른 409 의 응답 모양은 바뀌지 않는다 — 필드가 아예 안 실린다. */
    @Test
    fun `다른 충돌에는 여행 식별자가 실리지 않는다`() {
        val res = handler.handleDomain(ConflictDetected(message = "닉네임이 이미 사용 중입니다."))

        res.body!!.error.activeTripId shouldBe null
    }

}
