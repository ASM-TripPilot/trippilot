package com.trippilot.app.config

import com.fasterxml.jackson.core.JsonFactory
import com.fasterxml.jackson.core.JsonParseException
import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.core.JsonToken
import com.fasterxml.jackson.core.io.IOContext
import com.fasterxml.jackson.core.util.JsonParserDelegate
import java.io.DataInput
import java.io.InputStream
import java.io.Reader

/**
 * 요청 본문의 NUL(U+0000)을 **토큰을 읽는 자리에서** 거부한다(TRIP-1473).
 *
 * PostgreSQL 은 text·varchar 에 NUL 을 못 넣고 jsonb 도 `\u0000` 을 못 받는다. 거르지 않으면
 * 저장에서 터져 클라이언트 입력 문제가 **500** 으로 나갔다(실측: 여행 제목 · 취향 스냅숏의 키).
 * 요청 본문에 든 NUL 은 언제나 클라이언트가 보낸 값이라, 여기서 막으면 서버 버그를 가리지 않는다 —
 * 길이 초과(22001)를 전역으로 매핑하지 않는 이유와 갈리는 지점이다.
 *
 * **왜 역직렬화기가 아니라 파서인가.** String 역직렬화기를 갈아 끼우면 `JsonNode` 로 받는 본문
 * (`PUT /me/preferences`)과 `Map` 의 **키**(`preferenceSnapshot`)가 빠진다 — 둘 다 그 역직렬화기를 지나지 않는다.
 * 토큰 단위로 보면 값·키·자유형 객체가 한 곳을 지난다.
 *
 * 날 NUL 바이트는 JSON 문법이 이미 막는다(이스케이프되지 않은 제어 문자). 여기서 잡는 것은 `\u0000` 이스케이프다.
 * 던지는 [JsonParseException] 은 MVC 컨버터가 `HttpMessageNotReadableException` 으로 바꿔 400 이 된다
 * (`GlobalExceptionHandler.handleUnreadable`).
 */
class NulRejectingJsonFactory : JsonFactory {
    constructor() : super()
    private constructor(src: JsonFactory) : super(src, null)

    /** 상위 [JsonFactory.copy] 는 하위 클래스에서 부르면 예외를 던진다 — 복사본도 같은 검사를 지니게 직접 만든다. */
    override fun copy(): JsonFactory = NulRejectingJsonFactory(this)

    override fun _createParser(input: InputStream, ctxt: IOContext): JsonParser =
        NulRejectingParser(super._createParser(input, ctxt))

    override fun _createParser(r: Reader, ctxt: IOContext): JsonParser =
        NulRejectingParser(super._createParser(r, ctxt))

    override fun _createParser(data: CharArray, offset: Int, len: Int, ctxt: IOContext, recyclable: Boolean): JsonParser =
        NulRejectingParser(super._createParser(data, offset, len, ctxt, recyclable))

    override fun _createParser(data: ByteArray, offset: Int, len: Int, ctxt: IOContext): JsonParser =
        NulRejectingParser(super._createParser(data, offset, len, ctxt))

    override fun _createParser(input: DataInput, ctxt: IOContext): JsonParser =
        NulRejectingParser(super._createParser(input, ctxt))

    /**
     * `nextFieldName`·`nextTextValue` 같은 지름길은 [JsonParserDelegate] 가 넘기지 않아 기본 구현대로 [nextToken] 을
     * 거친다. [nextValue] 만 위임되므로 따로 잡는다 — 그 경로는 필드 이름 토큰을 건너뛰어, 이름은 [currentName] 으로 본다.
     */
    private class NulRejectingParser(p: JsonParser) : JsonParserDelegate(p) {
        override fun nextToken(): JsonToken? = super.nextToken().also(::check)
        override fun nextValue(): JsonToken? = super.nextValue().also(::check)

        private fun check(token: JsonToken?) {
            val nulInValue = token == JsonToken.VALUE_STRING && NUL in text
            if (nulInValue || currentName()?.contains(NUL) == true) {
                // 값은 싣지 않는다(SECURITY-15) — 로그(handleUnreadable)에도 이 문장만 남는다.
                throw JsonParseException(this, "요청 본문에 NUL(U+0000) 문자가 있다")
            }
        }
    }

    private companion object {
        const val NUL = '\u0000'
    }
}
