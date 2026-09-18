package com.trippilot.app

import com.fasterxml.jackson.core.JsonFactory
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import net.logstash.logback.mask.MaskingJsonGeneratorDecorator
import org.junit.jupiter.api.Test
import java.io.StringWriter

/**
 * SECURITY-03 마스킹 회귀 테스트 — 마스킹 데코레이터를 JSON 생성기에 직접 씌워 민감 필드/값 마스킹을 검증.
 * logback-spring.xml 이 쓰는 것과 동일한 MaskingJsonGeneratorDecorator + 동일 마스킹 목록을 검증한다.
 * ⚠️ path/value 목록은 logback-spring.xml 과 동기 유지.
 */
class MaskingLoggingTest {

    @Test
    fun `민감 필드와 값이 JSON 에서 마스킹된다`() {
        val masking = MaskingJsonGeneratorDecorator().apply {
            setDefaultMask("****")
            addPath("email")
            addPath("token")
            addPath("password")
            addValue("""Bearer\s+[A-Za-z0-9\-._~+/]+=*""")
            addValue("""[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}""")
            start()
        }

        val sw = StringWriter()
        val gen = masking.decorate(JsonFactory().createGenerator(sw))
        gen.writeStartObject()
        gen.writeStringField("email", "user@example.com")
        gen.writeStringField("token", "supersecrettoken")
        gen.writeStringField("note", "raw header Bearer aaa.bbb.ccc")
        gen.writeEndObject()
        gen.flush()
        gen.close()

        val json = sw.toString()

        // 민감 원문 비노출
        json shouldNotContain "user@example.com"
        json shouldNotContain "supersecrettoken"
        json shouldNotContain "aaa.bbb.ccc"
        // 마스크 적용 + 필드 키 유지
        json shouldContain "****"
        json shouldContain "\"email\""
    }
}
