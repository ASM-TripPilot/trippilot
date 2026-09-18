package com.trippilot.app.observability

import com.fasterxml.jackson.core.JsonFactory
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import net.logstash.logback.mask.MaskingJsonGeneratorDecorator
import org.junit.jupiter.api.Test
import java.io.StringWriter

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

    /**
     * 두 경로가 **같은 값을 가리는지** 실제 설정으로 확인한다.
     *
     * 이 테스트가 없던 동안 드리프트가 실제로 발생했다: LogMasker 에는 맨 JWT 규칙이 있었지만
     * logback-spring.xml 에는 없어서, `<path>` 목록에 없는 필드(MDC 의 traceId)에 실린 토큰이
     * stdout JSON 으로 그대로 나갔다(로컬 k8s 에서 실측). OTLP 경로만 가리고 있었다.
     *
     * 다른 테스트들이 이를 놓친 이유는 둘 다 설정을 **손으로 복사**해 검증했기 때문이다.
     * 그래서 여기서는 logback-spring.xml 을 직접 읽는다 — 복사본이 아니라 정본을 본다.
     */
    @Test
    fun `stdout 경로가 OTLP 경로와 같은 값을 가린다`() {
        val decorator = decoratorFromLogbackXml()

        listOf(
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl", // Bearer 없는 JWT 원문
            "Bearer abc.def.ghijkl",
            "user@example.com",
        ).forEach { secret ->
            // 민감하지 않은 필드명에 넣는다 — <path> 가 아니라 <value> 규칙만 검증하기 위해.
            maskAsJsonValue(decorator, secret) shouldNotContain secret
            LogMasker.mask(secret) shouldNotContain secret
        }
    }

    /** logback-spring.xml 의 `<value>` 목록으로 데코레이터를 만든다(손복사 금지). */
    private fun decoratorFromLogbackXml(): MaskingJsonGeneratorDecorator {
        val xml = checkNotNull(javaClass.getResourceAsStream("/logback-spring.xml")) {
            "logback-spring.xml 을 클래스패스에서 찾을 수 없습니다."
        }.bufferedReader().readText()

        val values = Regex("""<value>(.+?)</value>""").findAll(xml).map { it.groupValues[1] }.toList()
        check(values.isNotEmpty()) { "logback-spring.xml 에서 <value> 규칙을 찾지 못했습니다." }

        return MaskingJsonGeneratorDecorator().apply {
            setDefaultMask(LogMasker.MASK)
            values.forEach(::addValue)
            start()
        }
    }

    private fun maskAsJsonValue(decorator: MaskingJsonGeneratorDecorator, raw: String): String {
        val writer = StringWriter()
        decorator.decorate(JsonFactory().createGenerator(writer)).use { gen ->
            gen.writeStartObject()
            gen.writeStringField("note", raw)
            gen.writeEndObject()
        }
        return writer.toString()
    }
}
