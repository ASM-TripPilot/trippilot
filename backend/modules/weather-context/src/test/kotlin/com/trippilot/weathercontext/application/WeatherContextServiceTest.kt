package com.trippilot.weathercontext.application

import com.trippilot.weathercontext.domain.WeatherLookupFailed
import com.trippilot.weathercontext.domain.WeatherPort
import com.trippilot.weathercontext.domain.WeatherSnapshot
import com.trippilot.weathercontext.domain.WeatherSnapshotRepository
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset

/**
 * 날씨 조회·캐시(LC-U4-3).
 *
 * 지키려는 것:
 * - **INV-U4-09** 조회 실패 시 행을 만들지 않는다 · 만료분으로 발화하지 않는다
 * - **P-RES-U4-2** 표시에는 만료분도 쓰되 "확인 불가"로 표기한다(발화와 반대)
 * - **P-PERF-U4-1** 신선하면 외부를 부르지 않는다(호출은 격자 수만큼만)
 */
class WeatherContextServiceTest : StringSpec({

    val grid = "60,127"
    val baseAt = Instant.parse("2026-08-11T00:00:00Z")
    val expiresAt = baseAt.plus(Duration.ofHours(3))
    val now = Instant.parse("2026-08-11T01:00:00Z")

    fun snapshot(pop: Int = 70, base: Instant = baseAt, exp: Instant = expiresAt) =
        WeatherSnapshot(grid, base, pop, null, base, exp)

    class Snapshots(seed: WeatherSnapshot? = null) : WeatherSnapshotRepository {
        val stored = mutableListOf<WeatherSnapshot>().apply { seed?.let { add(it) } }
        override fun save(snapshot: WeatherSnapshot) = snapshot.also { stored += it }
        override fun findLatest(gridKey: String) = stored.filter { it.gridKey == gridKey }.maxByOrNull { it.baseAt }
    }

    class CountingPort(private val result: () -> WeatherSnapshot) : WeatherPort {
        var calls = 0
        override fun fetch(gridKey: String, at: Instant): WeatherSnapshot {
            calls++
            return result()
        }
    }

    fun service(port: WeatherPort, snapshots: Snapshots, at: Instant = now) =
        WeatherContextService(port, snapshots, Clock.fixed(at, ZoneOffset.UTC))

    "신선한 스냅숏이 있으면 외부를 부르지 않는다(P-PERF-U4-1)" {
        val port = CountingPort { snapshot() }
        val snapshots = Snapshots(snapshot())

        service(port, snapshots).precipProbabilityForTrigger(grid, now) shouldBe 70
        port.calls shouldBe 0
    }

    "없으면 한 번 부르고 저장한다" {
        val port = CountingPort { snapshot(pop = 40) }
        val snapshots = Snapshots()

        service(port, snapshots).precipProbabilityForTrigger(grid, now) shouldBe 40
        port.calls shouldBe 1
        snapshots.stored.size shouldBe 1
    }

    "조회에 실패하면 발화용 값이 없고 행도 만들지 않는다(INV-U4-09)" {
        val port = object : WeatherPort {
            override fun fetch(gridKey: String, at: Instant) = throw WeatherLookupFailed("타임아웃")
        }
        val snapshots = Snapshots()

        service(port, snapshots).precipProbabilityForTrigger(grid, now) shouldBe null
        snapshots.stored.size shouldBe 0 // 실패를 0% 같은 값으로 채워 저장하면 없는 사실을 알리게 된다
    }

    "만료분으로는 발화하지 않는다 — 낡은 근거로 개입하면 그게 허위 알림이다" {
        val stale = snapshot(base = baseAt.minus(Duration.ofHours(6)), exp = baseAt.minus(Duration.ofHours(3)))
        val port = object : WeatherPort {
            override fun fetch(gridKey: String, at: Instant) = throw WeatherLookupFailed("타임아웃")
        }
        // 만료분이 캐시에 있지만 갱신도 실패한 상황
        service(port, Snapshots(stale)).precipProbabilityForTrigger(grid, now) shouldBe null
    }

    "표시에는 만료분도 쓰되 stale 로 밝힌다(P-RES-U4-2 역방향)" {
        val stale = snapshot(pop = 80, base = baseAt.minus(Duration.ofHours(6)), exp = baseAt.minus(Duration.ofHours(3)))
        val port = object : WeatherPort {
            override fun fetch(gridKey: String, at: Instant) = throw WeatherLookupFailed("타임아웃")
        }

        val reading = service(port, Snapshots(stale)).readingForDisplay(grid, now)!!
        reading.precipProbability shouldBe 80
        reading.stale shouldBe true // 화면은 "확인 불가"로 표기한다
    }

    "신선하면 표시도 stale 이 아니다" {
        service(CountingPort { snapshot() }, Snapshots(snapshot())).readingForDisplay(grid, now)!!.stale shouldBe false
    }

    "한 번도 받아오지 못했으면 표시할 것도 없다" {
        val port = object : WeatherPort {
            override fun fetch(gridKey: String, at: Instant) = throw WeatherLookupFailed("타임아웃")
        }
        service(port, Snapshots()).readingForDisplay(grid, now) shouldBe null
    }

    "만료 직전·직후 경계 — 만료 시각 자체는 이미 신선하지 않다" {
        val snap = snapshot()
        snap.isFreshAt(expiresAt.minusMillis(1)) shouldBe true
        snap.isFreshAt(expiresAt) shouldBe false
    }
})
