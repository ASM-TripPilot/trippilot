package com.trippilot.weathercontext.adapter.out.persistence

import com.trippilot.weathercontext.domain.GridForecast
import com.trippilot.weathercontext.domain.GridForecastRepository
import com.trippilot.weathercontext.domain.GridHour
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.LocalDateTime

/**
 * weather_grid_forecast 매핑 — 격자당 1행(PK = 격자 키). jsonb 는 원시값 맵으로 둔다(수동 직렬화 금지 — anti-patterns TRIP-155).
 *
 * `hourly` = `{"2026-10-20T14:00": {"pop":60,"pty":1,"sky":4,"tmp":18.0,"wsd":3.2}}`.
 * 모르는 칸은 키를 두지 않는다(null 을 쓰지 않는다).
 * 날짜별 TMN·TMX(`daily`) 칸은 없다 — 읽는 곳이 없어져(G-SA-15 결정 2026-10-20) V2.81 에서 기본값만 두었다가 V2.86 에서 지웠다.
 */
@Entity
@Table(name = "weather_grid_forecast")
class GridForecastEntity(
    @Id @Column(name = "grid_key") var gridKey: String,
    @Column(name = "base_at") var baseAt: Instant,
    @JdbcTypeCode(SqlTypes.JSON) @Column(name = "hourly") var hourly: Map<String, Any>,
    @Column(name = "fetched_at") var fetchedAt: Instant,
    @Column(name = "expires_at") var expiresAt: Instant,
) {
    protected constructor() : this("", Instant.EPOCH, emptyMap(), Instant.EPOCH, Instant.EPOCH)
}

interface GridForecastJpaRepository : JpaRepository<GridForecastEntity, String>

@Component
class GridForecastPersistence(private val jpa: GridForecastJpaRepository) : GridForecastRepository {

    override fun find(gridKey: String): GridForecast? = jpa.findById(gridKey).orElse(null)?.toDomain()

    /** 키가 늘 채워져 있어 Spring Data 가 merge(조회 후 INSERT·UPDATE)로 보낸다 — 같은 격자는 덮인다. */
    override fun save(forecast: GridForecast): GridForecast =
        jpa.saveAndFlush(
            GridForecastEntity(
                forecast.gridKey, forecast.baseAt,
                forecast.hourly.entries.associate { (at, h) ->
                    at.toString() to listOfNotNull(
                        h.pop?.let { "pop" to it }, h.pty?.let { "pty" to it }, h.sky?.let { "sky" to it },
                        h.tmp?.let { "tmp" to it }, h.wsd?.let { "wsd" to it },
                    ).toMap()
                },
                forecast.fetchedAt, forecast.expiresAt,
            ),
        ).toDomain()

    /**
     * jsonb 를 되읽으면 수 타입이 바뀐다 — `18.0` 이 정수로, `60` 이 실수로 돌아올 수 있다. 그래서 **Number 로 받아** 정규화한다
     * (`as? Double` 로 받으면 정수로 적힌 기온이 조용히 모름이 된다 — anti-patterns TRIP-854).
     *
     * 허용 편차(PBT-02 왕복 — `GridForecastPersistenceIT`): `-0.0` 은 `0.0` 으로 돌아온다. jsonb 의 수는 numeric 이라 음의 0 이
     * 없다 — 임계 판정과 무관하다. 그 밖의 값은 같은 값으로 돌아온다.
     */
    private fun GridForecastEntity.toDomain() = GridForecast(
        gridKey = gridKey,
        baseAt = baseAt,
        hourly = hourly.entries.associate { (at, v) ->
            val m = v as Map<*, *>
            LocalDateTime.parse(at) to GridHour(m.int("pop"), m.int("pty"), m.int("sky"), m.double("tmp"), m.double("wsd"))
        },
        fetchedAt = fetchedAt,
        expiresAt = expiresAt,
    )

    private fun Map<*, *>.int(key: String): Int? = (this[key] as? Number)?.toInt()

    private fun Map<*, *>.double(key: String): Double? = (this[key] as? Number)?.toDouble()
}
