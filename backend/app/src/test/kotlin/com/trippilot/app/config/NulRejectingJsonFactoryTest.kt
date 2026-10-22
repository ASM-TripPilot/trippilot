package com.trippilot.app.config

import com.fasterxml.jackson.core.JsonParseException
import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.core.JsonToken
import com.fasterxml.jackson.databind.ObjectMapper
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

/**
 * 파서 단위로 본다 — HTTP 경로(`InputErrorContractIT`)는 역직렬화기가 어느 진입점([JsonParser.nextToken]·
 * [JsonParser.nextValue])으로 읽는지 고르지 못한다. 위임 파서가 한쪽에서 검사를 놓치면 그쪽으로 읽는 소비자에서 조용히 샌다.
 */
class NulRejectingJsonFactoryTest {

    private val factory = NulRejectingJsonFactory()

    private fun drain(json: String, step: (JsonParser) -> JsonToken?) =
        factory.createParser(json).use { p -> while (step(p) != null) Unit }

    @Test
    fun `값의 NUL 은 nextToken·nextValue 어느 쪽으로 읽어도 거부된다`() {
        shouldThrow<JsonParseException> { drain("""{"a":"x\u0000"}""") { it.nextToken() } }
        shouldThrow<JsonParseException> { drain("""{"a":"x\u0000"}""") { it.nextValue() } }
    }

    /** nextValue 는 필드 이름 토큰을 건너뛴다 — 이름은 currentName 으로만 보인다. */
    @Test
    fun `키의 NUL 은 nextToken·nextValue 어느 쪽으로 읽어도 거부된다`() {
        shouldThrow<JsonParseException> { drain("""{"a\u0000":1}""") { it.nextToken() } }
        shouldThrow<JsonParseException> { drain("""{"a\u0000":1}""") { it.nextValue() } }
    }

    @Test
    fun `배열 안 · 깊은 객체 안의 NUL 도 거부된다`() {
        shouldThrow<JsonParseException> { drain("""[1,["\u0000"]]""") { it.nextToken() } }
        shouldThrow<JsonParseException> { drain("""{"a":{"b":{"c":"\u0000"}}}""") { it.nextToken() } }
    }

    /** 상위 copy 는 하위 클래스에서 예외를 던진다 — ObjectMapper.copy() 가 그 경로다. */
    @Test
    fun `복사한 매퍼도 같은 검사를 지닌다`() {
        val copied = ObjectMapper(factory).copy()

        shouldThrow<JsonParseException> { copied.readTree("""{"a":"\u0000"}""") }
    }

    @Test
    fun `NUL 이 아닌 값은 그대로 읽힌다 — 대조군`() {
        val node = ObjectMapper(factory).readTree("""{"a":"café","b":"\\u0000","c":[1,null,true]}""")

        node["a"].asText() shouldBe "café"
        node["b"].asText() shouldBe "\\u0000"
        node["c"].size() shouldBe 3
    }
}
