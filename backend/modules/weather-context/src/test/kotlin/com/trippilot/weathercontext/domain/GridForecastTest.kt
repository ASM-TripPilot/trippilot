package com.trippilot.weathercontext.domain

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Duration
import java.time.Instant

/** 격자 예보의 만료 — 발화 신선도 판정의 기준이라 뒤집히면 낡은 근거로 개입한다(INV-U4-09). DB CHECK 와 같은 규칙이다. */
class GridForecastTest : StringSpec({

    val base = Instant.parse("2026-10-19T23:00:00Z")

    fun grid(expiresAt: Instant) = GridForecast("53,38", base, emptyMap(), emptyMap(), base, expiresAt)

    "만료가 발표보다 늦지 않으면 만들 수 없다" {
        shouldThrow<IllegalArgumentException> { grid(base) }
        shouldThrow<IllegalArgumentException> { grid(base.minusSeconds(1)) }
    }

    "만료 시각 자체는 이미 신선하지 않다" {
        val g = grid(base.plus(Duration.ofMinutes(190)))
        g.isFreshAt(g.expiresAt.minusMillis(1)) shouldBe true
        g.isFreshAt(g.expiresAt) shouldBe false
    }
})
