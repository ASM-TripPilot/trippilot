package com.trippilot.app

import com.trippilot.app.web.CorrelationIdFilter
import com.trippilot.app.web.error.GlobalExceptionHandler
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.RateLimited
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.core.error.ValidationFailed
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import org.junit.jupiter.api.AfterEach
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
}
