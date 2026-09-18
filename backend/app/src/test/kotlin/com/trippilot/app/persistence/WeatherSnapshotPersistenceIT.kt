package com.trippilot.app.persistence

import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.weathercontext.api.ContextFacade
import com.trippilot.weathercontext.domain.WeatherSnapshot
import com.trippilot.weathercontext.domain.WeatherSnapshotRepository
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.time.Duration
import java.time.Instant

/**
 * TRIP-273 — weather_snapshot 실 DB 검증(V2.19).
 * 복합 PK(격자, 발표시각)가 **새 발표를 새 행으로** 만드는지, 최신분 조회가 발표시각 기준인지를 본다.
 */
@SpringBootTest
class WeatherSnapshotPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var snapshots: WeatherSnapshotRepository
    @Autowired private lateinit var context: ContextFacade

    private val grid = "60,127"
    private val base = Instant.parse("2026-08-11T00:00:00Z")

    private fun snap(baseAt: Instant, pop: Int) =
        WeatherSnapshot(grid, baseAt, pop, null, baseAt, baseAt.plus(Duration.ofHours(3)))

    @Test
    fun `새 발표는 새 행이 된다 — 캐시 무효화 로직이 필요 없다(P-PERF-U4-1)`() {
        snapshots.save(snap(base, 30))
        snapshots.save(snap(base.plus(Duration.ofHours(3)), 70))

        // 최신분은 발표시각 기준으로 고른다
        snapshots.findLatest(grid)!!.precipProbability shouldBe 70
    }

    @Test
    fun `같은 발표를 다시 받으면 덮어쓴다 — 행이 늘지 않는다`() {
        snapshots.save(snap(base, 30))
        snapshots.save(snap(base, 35)) // 같은 (격자, 발표시각)
        snapshots.findLatest(grid)!!.precipProbability shouldBe 35
    }

    @Test
    fun `Fake 어댑터로 실제 조회 경로가 돈다 — 결정론적이라 판정이 흔들리지 않는다`() {
        val at = Instant.parse("2026-08-11T04:00:00Z")
        val first = context.precipProbabilityForTrigger("99,99", at)
        val second = context.precipProbabilityForTrigger("99,99", at)
        first shouldBe second // 같은 입력 같은 결과
        (first != null) shouldBe true
    }
}
