package com.trippilot.auth.application

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.port.PendingRevocation
import com.trippilot.auth.domain.port.ProviderRevocationTokenRepository
import com.trippilot.auth.domain.port.ProviderTokenRevocationPort
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import org.slf4j.LoggerFactory
import org.springframework.web.client.HttpServerErrorException
import org.springframework.web.client.ResourceAccessException
import org.springframework.http.HttpStatus
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * TRIP-933 — 파기 시점 revoke 스위프. 재는 것은 **revoke 가 실패해도 무엇도 멈추지 않는가**다.
 * Apple 이 5xx 이거나 도달 불가일 때 스위프가 던지면, 그 뒤에 붙을 파기 배치가 같이 멈춘다.
 */
class ProviderTokenRevocationSweeperTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-10-23T00:00:00Z"), ZoneOffset.UTC)
    val ok = PendingRevocation(UUID.randomUUID(), Provider.APPLE, "token-ok")
    val down = PendingRevocation(UUID.randomUUID(), Provider.APPLE, "token-5xx")
    val unreachable = PendingRevocation(UUID.randomUUID(), Provider.APPLE, "token-unreachable")

    class Tokens(private val due: List<PendingRevocation>) : ProviderRevocationTokenRepository {
        val cleared = mutableListOf<UUID>()
        var askedAt: Instant? = null
        override fun store(provider: Provider, providerSub: String, token: String) = Unit
        override fun findDueForRevocation(now: Instant, limit: Int): List<PendingRevocation> {
            askedAt = now
            return due.filterNot { it.socialIdentityId in cleared }
        }
        override fun clear(socialIdentityId: UUID) { cleared += socialIdentityId }
    }

    class Revocation(private val healthy: Boolean) : ProviderTokenRevocationPort {
        val revoked = mutableListOf<String>()
        override fun exchangeRevocationToken(provider: Provider, authorizationCode: String, expectedSub: String) = null
        override fun revoke(provider: Provider, token: String) {
            when {
                healthy || token == "token-ok" -> revoked += token
                token == "token-5xx" -> throw HttpServerErrorException(HttpStatus.BAD_GATEWAY)
                else -> throw ResourceAccessException("connect timed out")
            }
        }
    }

    "revoke 가 실패해도 스위프는 던지지 않고 다음 대상으로 간다 — 파기 경로를 막지 않는다" {
        val tokens = Tokens(listOf(down, ok, unreachable))
        val revocation = Revocation(healthy = false)

        ProviderTokenRevocationSweeper(tokens, revocation, clock).sweep() // 던지면 여기서 실패한다

        revocation.revoked shouldContainExactly listOf("token-ok")
        // 성공한 것만 지운다 — 실패한 둘은 남아 다음 회차의 재시도 대상이다.
        tokens.cleared shouldContainExactly listOf(ok.socialIdentityId)
        tokens.askedAt shouldBe clock.instant()
    }

    "실패로 남은 토큰은 Apple 이 살아나면 다음 회차에 revoke 된다" {
        val tokens = Tokens(listOf(down, ok))
        ProviderTokenRevocationSweeper(tokens, Revocation(healthy = false), clock).sweep()

        val recovered = Revocation(healthy = true)
        ProviderTokenRevocationSweeper(tokens, recovered, clock).sweep()

        recovered.revoked shouldContainExactly listOf("token-5xx")
        tokens.cleared shouldContainExactly listOf(ok.socialIdentityId, down.socialIdentityId)
    }

    "실패 로그에 토큰 값을 싣지 않는다(SECURITY-15)" {
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        val logger = LoggerFactory.getLogger(ProviderTokenRevocationSweeper::class.java) as Logger
        logger.addAppender(appender)
        try {
            ProviderTokenRevocationSweeper(Tokens(listOf(down, unreachable)), Revocation(healthy = false), clock).sweep()
        } finally {
            logger.detachAppender(appender)
        }

        appender.list.size shouldBe 3 // 실패 2 + 요약 1
        appender.list.forEach {
            it.formattedMessage shouldNotContain "token-5xx"
            it.formattedMessage shouldNotContain "token-unreachable"
        }
    }

    "PendingRevocation 은 문자열로 찍혀도 토큰을 드러내지 않는다" {
        ok.toString() shouldNotContain "token-ok"
    }
})
