package com.trippilot.app.observability

import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.junit.jupiter.api.Test

/**
 * 로그 경로가 둘로 갈린 뒤(TRIP-218) 생긴 위험을 고정한다.
 *
 * - stdout JSON 경로 : logback-spring.xml 의 MaskingJsonGeneratorDecorator (MaskingLoggingTest 가 검증)
 * - OTLP 경로        : MaskingAppender → LogMasker  ← 이 테스트가 검증
 *
 * 두 경로가 **같은 것을 가린다**는 보장이 없으면, 한쪽만 고쳤을 때 수집기로 원문이 새 나간다.
 *
 * ⚠️ logback-spring.xml 의 path/value 목록을 고치면 LogMasker 와 이 테스트를 함께 고칠 것.
 */
class MaskingParityTest {

    /** logback-spring.xml `<value>` ① — Bearer 토큰 */
    @Test
    fun `Bearer 토큰 원문을 남기지 않는다`() {
        val masked = LogMasker.mask("inbound header Authorization: Bearer aaa.bbb.ccc")
        masked shouldNotContain "aaa.bbb.ccc"
        masked shouldContain LogMasker.MASK
    }

    /** logback-spring.xml `<value>` ② — 이메일 주소 */
    @Test
    fun `이메일 주소를 남기지 않는다`() {
        LogMasker.mask("가입 시도 user@example.com") shouldBe "가입 시도 ${LogMasker.MASK}"
    }

    @Test
    fun `JWT 원문을 남기지 않는다`() {
        val jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.signature"
        LogMasker.mask("idToken=$jwt") shouldNotContain jwt
    }

    /** logback-spring.xml `<path>` 목록에 대응 — 평문 로그의 키=값 */
    @Test
    fun `민감 키의 값을 남기지 않는다`() {
        listOf(
            "password" to "hunter2",
            "passwordHash" to "argon2idhash",
            "refreshToken" to "rtabcdef123456",
            "socialCode" to "codexyz",
            "resetToken" to "rst999",
        ).forEach { (key, secret) ->
            val masked = LogMasker.mask("$key=$secret")
            masked shouldNotContain secret
            masked shouldContain key // 키는 검색 축이므로 보존
        }
    }

    @Test
    fun `마스크 문자열이 JSON 경로와 같다`() {
        // logback-spring.xml 의 defaultMask 와 어긋나면 로그 검색 필터가 경로마다 달라진다.
        LogMasker.MASK shouldBe "****"
    }

    @Test
    fun `MDC 는 키를 보존하고 값만 마스킹한다`() {
        val masked = LogMasker.maskValues(
            mapOf("traceId" to "9f3c1a2b4d5e6f70", "actor" to "user@example.com"),
        )
        masked!!.keys shouldBe setOf("traceId", "actor")
        masked["traceId"] shouldBe "9f3c1a2b4d5e6f70" // 상관 ID 는 가리면 안 된다
        masked["actor"] shouldBe LogMasker.MASK
    }

    @Test
    fun `민감하지 않은 문자열은 그대로 둔다`() {
        val plain = "일정 생성 완료 tripId=trip-00042 dayCount=3"
        LogMasker.mask(plain) shouldBe plain
    }

    @Test
    fun `null 과 빈 문자열은 그대로 통과한다`() {
        LogMasker.mask(null) shouldBe null
        LogMasker.mask("") shouldBe ""
    }
}
