package com.trippilot.notification.application

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.OsPermission
import com.trippilot.notification.domain.PushToken
import com.trippilot.notification.domain.PushTokenRepository
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import org.slf4j.LoggerFactory
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 푸시 토큰 등록의 **관측 줄**. 새 앱 빌드가 토큰을 만들기 시작했는지를 DB 접근 없이 로그로 세기 위한 것이다
 * (운영 `push.dispatch` 가 전부 NO_DEVICE 였던 때, 등록 쪽은 어디에도 흔적이 없었다).
 */
class PushTokenServiceTest : StringSpec({

    val account = UUID.randomUUID()
    val service = PushTokenService(FakeTokens(), Clock.fixed(Instant.parse("2026-11-04T00:00:00Z"), ZoneOffset.UTC))

    "처음 보는 토큰만 한 줄 남긴다 — 같은 토큰을 다시 보내면(포그라운드 복귀) 줄이 없다" {
        val lines = registerLines {
            service.register(account, "ExponentPushToken[aaa]", "dev-1", DevicePlatform.IOS, OsPermission.GRANTED)
            service.register(account, "ExponentPushToken[aaa]", "dev-1", DevicePlatform.IOS, OsPermission.GRANTED)
            service.register(account, "ExponentPushToken[bbb]", null, DevicePlatform.ANDROID, OsPermission.DENIED)
        }

        lines shouldContainExactly listOf(
            "push.token.register platform=IOS osPermission=GRANTED deliverable=true",
            "push.token.register platform=ANDROID osPermission=DENIED deliverable=false",
        )
    }

    "줄에 토큰 값을 싣지 않는다" {
        val lines = registerLines {
            service.register(account, "ExponentPushToken[secret-value]", null, DevicePlatform.IOS, OsPermission.GRANTED)
        }

        lines.size shouldBe 1 // 줄이 아예 없어서 통과하는 일이 없게 — 한 줄은 남고, 그 줄에 값이 없다
        lines.none { "secret-value" in it || "ExponentPushToken" in it } shouldBe true
    }
})

/** 서비스 로거의 `push.token.register` 줄만 모은다. */
private fun registerLines(block: () -> Unit): List<String> {
    val appender = ListAppender<ILoggingEvent>().apply { start() }
    val logger = LoggerFactory.getLogger(PushTokenService::class.java) as Logger
    logger.addAppender(appender)
    try {
        block()
    } finally {
        logger.detachAppender(appender)
    }
    return appender.list.map { it.formattedMessage }.filter { it.startsWith("push.token.register ") }
}

/** 실 저장소처럼 같은 토큰이면 **기존 행의 id 를 돌려준다**(갱신) — 새 토큰이면 들어온 값 그대로(삽입). */
private class FakeTokens : PushTokenRepository {
    private val byToken = mutableMapOf<String, PushToken>()

    override fun register(token: PushToken): PushToken =
        byToken.merge(token.token, token) { old, new -> new.copy(pushTokenId = old.pushTokenId) }!!

    override fun findActive(accountId: UUID): List<PushToken> =
        byToken.values.filter { it.accountId == accountId && it.invalidatedAt == null }

    override fun invalidate(token: String, at: Instant): Boolean = false
    override fun invalidateIfNotSeenSince(token: String, notSeenAfter: Instant, at: Instant) = false

    override fun remove(accountId: UUID, token: String): Boolean = false
}
