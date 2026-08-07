package com.trippilot.app.observability

import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.spi.IThrowableProxy
import ch.qos.logback.core.UnsynchronizedAppenderBase
import ch.qos.logback.core.spi.AppenderAttachable
import ch.qos.logback.core.spi.AppenderAttachableImpl

/**
 * 하위 appender 로 넘어가는 이벤트를 마스킹하는 게이트.
 *
 * `logback-spring.xml` 에서 OTLP appender 를 이 안에 중첩한다. stdout JSON 경로는 인코더의
 * MaskingJsonGeneratorDecorator 가 이미 담당하므로 감싸지 않는다 — 이중 마스킹은 불필요하다.
 */
class MaskingAppender(
    private val nested: AppenderAttachableImpl<ILoggingEvent> = AppenderAttachableImpl(),
) : UnsynchronizedAppenderBase<ILoggingEvent>(), AppenderAttachable<ILoggingEvent> by nested {

    override fun append(eventObject: ILoggingEvent) {
        nested.appendLoopOnAppenders(MaskedLoggingEvent(eventObject))
    }

    override fun start() {
        if (!nested.iteratorForAppenders().hasNext()) {
            addWarn("MaskingAppender 에 중첩된 appender 가 없습니다 — 이 경로의 로그는 유실됩니다.")
        }
        nested.iteratorForAppenders().forEach { if (!it.isStarted) it.start() }
        super.start()
    }

    override fun stop() {
        nested.detachAndStopAllAppenders()
        super.stop()
    }
}

/**
 * 사람이 읽는 표면(메시지·MDC·예외 메시지)을 마스킹해 넘기는 래퍼.
 *
 * Kotlin 인터페이스 위임을 쓰는 이유: logback 버전이 올라 ILoggingEvent 에 메서드가 추가돼도
 * 위임이 자동 생성돼 컴파일이 깨지지 않는다.
 */
internal class MaskedLoggingEvent(
    private val delegate: ILoggingEvent,
) : ILoggingEvent by delegate {

    // 이미 포맷된 문자열을 마스킹해 넘기므로 인자 배열은 비운다(중복 포맷 방지).
    // OTLP appender 는 formattedMessage·MDC·throwable 만 읽으므로 손실이 없다.
    override fun getArgumentArray(): Array<Any?>? = null

    override fun getMessage(): String? = LogMasker.mask(delegate.formattedMessage)

    override fun getFormattedMessage(): String? = LogMasker.mask(delegate.formattedMessage)

    override fun getMDCPropertyMap(): Map<String, String>? = LogMasker.maskValues(delegate.mdcPropertyMap)

    // 예외 메시지에도 토큰·이메일이 실려 나가는 경로가 실재한다.
    override fun getThrowableProxy(): IThrowableProxy? =
        delegate.throwableProxy?.let(::MaskedThrowableProxy)
}

internal class MaskedThrowableProxy(
    private val delegate: IThrowableProxy,
) : IThrowableProxy by delegate {

    override fun getMessage(): String? = LogMasker.mask(delegate.message)

    override fun getCause(): IThrowableProxy? = delegate.cause?.let(::MaskedThrowableProxy)

    override fun getSuppressed(): Array<IThrowableProxy>? =
        delegate.suppressed?.map(::MaskedThrowableProxy)?.toTypedArray()
}
