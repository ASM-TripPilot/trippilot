package com.trippilot.archive.application

import com.trippilot.archive.api.event.ActualRouteStored
import com.trippilot.archive.domain.ActualRouteDay
import com.trippilot.archive.domain.ActualRouteDayRepository
import com.trippilot.archive.domain.Polyline
import com.trippilot.auth.api.LocationCollectionSource
import com.trippilot.auth.api.LocationConsentFacade
import com.trippilot.auth.api.LocationIntervalPhase
import com.trippilot.auth.api.LocationLegalLogFacade
import com.trippilot.auth.api.LocationPurgeScope
import com.trippilot.auth.api.LocationUsePurpose
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import com.trippilot.trip.api.TripPurgeScopeFacade
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.ints.shouldBeGreaterThanOrEqual
import io.kotest.matchers.doubles.shouldBeLessThanOrEqual as shouldBeLessThanOrEqual0
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 실제 경로(U10 FD §3·§12.3 · BR-U10-38·43·45 · INV-U10-1·4 · PBT-U10-1·6).
 *
 * 지키려는 것: 동의 없으면 행이 생기지 않는다 · 저장 1번에 수집 로그 1건 · 철회하면 전부 지우고 지운 것이 있을 때만 파기 1건 ·
 * 거리는 폴리라인 길이 이상 물리 상한 이하 · 상한을 넘는 입력은 푸는 도중 멈춘다.
 */
class ActualRouteServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val day = LocalDate.parse("2026-08-11")
    val now = Instant.parse("2026-08-11T12:00:00Z")

    /** Google 문서의 예 — (38.5,-120.2) (40.7,-120.95) (43.252,-126.453). 세 점, 약 790km. */
    val sample = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
    /** 서울 시내 약 1.1km 한 구간(두 점). */
    val short = Polyline.encode(listOf(Polyline.Point(37.5665, 126.9780), Polyline.Point(37.5759, 126.9768)))

    class Routes : ActualRouteDayRepository {
        val rows = mutableMapOf<Pair<UUID, LocalDate>, ActualRouteDay>()
        override fun upsert(day: ActualRouteDay): ActualRouteDay {
            val kept = rows[day.tripId to day.localDate]
            return day.copy(routeDayId = kept?.routeDayId ?: day.routeDayId, createdAt = kept?.createdAt ?: day.createdAt)
                .also { rows[day.tripId to day.localDate] = it }
        }
        override fun findByTrip(tripId: UUID) = rows.values.filter { it.tripId == tripId }.sortedBy { it.localDate }
        override fun deleteByTrips(tripIds: List<UUID>): Int {
            val gone = rows.keys.filter { it.first in tripIds }
            gone.forEach(rows::remove)
            return gone.size
        }
    }

    class Logs : LocationLegalLogFacade {
        val stored = mutableListOf<Pair<UUID, Int?>>()
        val purged = mutableListOf<Pair<LocationPurgeScope, Int>>()
        override fun recordCollection(accountId: UUID, source: LocationCollectionSource, subjectId: UUID, pointCount: Int?) {
            check(source == LocationCollectionSource.ROUTE_TRACE)
            stored += subjectId to pointCount
        }
        override fun recordPurge(accountId: UUID, scope: LocationPurgeScope, purgedCount: Int) { purged += scope to purgedCount }
        override fun recordUseInterval(
            accountId: UUID, purpose: LocationUsePurpose, intervalId: UUID, tripId: UUID,
            phase: LocationIntervalPhase, at: Instant, endReason: String?, regionCount: Int?,
        ) = error("경로는 구간 로그를 쓰지 않는다")
        override fun recordCollectionInterval(
            accountId: UUID, source: LocationCollectionSource, intervalId: UUID, tripId: UUID,
            phase: LocationIntervalPhase, at: Instant, endReason: String?, pointCount: Int?,
        ) = error("경로는 구간 로그를 쓰지 않는다")
    }

    class Consents(var legal: Boolean = true, var gps: Boolean = true) : LocationConsentFacade {
        override fun hasGpsRecordingOptIn(accountId: UUID) = gps
        override fun hasLocationLegalConsent(accountId: UUID) = legal
    }

    class World(
        val routes: Routes = Routes(),
        val logs: Logs = Logs(),
        val consents: Consents = Consents(),
        val events: CapturingEvents = CapturingEvents(),
    )

    fun World.service() = ActualRouteService(
        object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) =
                if (accountId == acc) TripPeriod(LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12")) else null
            override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
        },
        object : TripPurgeScopeFacade { override fun findAllTripIdsOf(accountId: UUID) = if (accountId == acc) listOf(tripId) else emptyList() },
        routes, consents, logs, events, Clock.fixed(now, ZoneOffset.UTC),
    )

    fun upload(segments: List<String> = listOf(short), distance: Int = 1500, raw: Int = 40) =
        RouteDayUpload(segments, distance, raw, storedPointCount = null)

    "폴리라인을 푼다 — Google 문서의 예" {
        Polyline.decode(sample, limit = 10) shouldBe listOf(
            Polyline.Point(38.5, -120.2), Polyline.Point(40.7, -120.95), Polyline.Point(43.252, -126.453),
        )
        Polyline.decode(Polyline.encode(Polyline.decode(sample, 10)), 10) shouldBe Polyline.decode(sample, 10)
    }

    "상한을 넘으면 푸는 도중 멈추고, 깨진 문자열은 거절한다" {
        shouldThrow<Polyline.TooManyPoints> { Polyline.decode(sample, limit = 2) }
        shouldThrow<Polyline.TooManyPoints> { Polyline.decode(sample, limit = 5, already = 3) }
        shouldThrow<Polyline.Malformed> { Polyline.decode("_p~iF~ps|U_", 10) } // 값 중간에서 잘림
        shouldThrow<Polyline.Malformed> { Polyline.decode("_p~iF~ps|U\u0001\u0001", 10) } // 범위 밖 문자
    }

    "저장하면 행 1·수집 로그 1·저장 이벤트 1 — 재업로드는 같은 행을 통째로 바꾸고 로그를 하나 더 남긴다" {
        val w = World()
        val first = w.service().store(acc, tripId, day, upload())
        val second = w.service().store(acc, tripId, day, upload(distance = 2000, raw = 60))

        w.routes.rows.size shouldBe 1
        second.routeDayId shouldBe first.routeDayId // 법정 로그의 subjectId 가 바뀌지 않는다
        (second.distanceM to second.rawPointCount) shouldBe (2000 to 60)
        w.logs.stored shouldBe listOf(first.routeDayId to 2, first.routeDayId to 2) // 저장할 때마다 사실 1건 · 점 수는 서버가 센 값
        w.events.published.map { (it as ActualRouteStored).localDate } shouldBe listOf("2026-08-11", "2026-08-11")
    }

    /** INV-U10-1 — L3 가 거짓인 계정에는 경로 행이 생기지 않는다. D4 — L2 도 있어야 한다. */
    "동의가 없으면 저장하지 않는다 — 기기가 강등할 수 있게 코드로 알린다" {
        listOf(Consents(legal = false), Consents(gps = false)).forEach { c ->
            val w = World(consents = c)
            shouldThrow<ConflictDetected> { w.service().store(acc, tripId, day, upload()) }.errorCode shouldBe ErrorCode.LOCATION_CONSENT_REQUIRED
            (w.routes.rows.size + w.logs.stored.size) shouldBe 0
        }
    }

    "잘못된 업로드는 아무것도 남기지 않는다" {
        val w = World()
        val svc = w.service()
        shouldThrow<ResourceNotFound> { svc.store(UUID.randomUUID(), tripId, day, upload()) }
        shouldThrow<ValidationFailed> { svc.store(acc, tripId, LocalDate.parse("2026-08-13"), upload()) } // 여행 기간 밖
        shouldThrow<ValidationFailed> { svc.store(acc, tripId, day, upload(raw = 1)) } // 원시 < 저장
        shouldThrow<ValidationFailed> { svc.store(acc, tripId, day, upload(segments = List(ActualRouteService.MAX_SEGMENTS + 1) { short })) }
        shouldThrow<ValidationFailed> { svc.store(acc, tripId, day, upload(segments = listOf("~~~~"))) }
        shouldThrow<ValidationFailed> { svc.store(acc, tripId, day, upload(segments = emptyList())) } // 점 없이 거리만
        // 기록 구간에 비해 물리적으로 불가능한 길이 — 790km 를 1분에
        shouldThrow<ValidationFailed> { svc.store(acc, tripId, day, upload(segments = listOf(sample), raw = 10).copy(recordedFrom = now.minusSeconds(60), recordedTo = now)) }
        // 점 상한 — 세그먼트를 나눠도 합으로 센다
        val manyPoints = Polyline.encode(List(1_001) { Polyline.Point(37.0 + it * 1e-4, 127.0) })
        shouldThrow<ValidationFailed> { svc.store(acc, tripId, day, upload(segments = listOf(manyPoints, manyPoints), raw = 5_000)) }
        shouldThrow<ValidationFailed> {
            svc.store(acc, tripId, day, upload().copy(recordedFrom = now, recordedTo = now.minusSeconds(1)))
        }
        (w.routes.rows.size + w.logs.stored.size + w.events.published.size) shouldBe 0
    }

    /** PBT-U10-6 — 저장된 거리는 폴리라인 길이 이상 · 물리 상한 이하이고, 입력과 다르면 클램프 표시가 선다. */
    "거리는 폴리라인 길이와 물리 상한 사이로 깎이고, 깎였으면 표시한다" {
        checkAll(Arb.int(0..2_000_000), Arb.element(60L, 600L, 3_600L, 86_400L), Arb.list(Arb.boolean(), 1..4)) { reported, seconds, shape ->
            val w = World()
            val segments = shape.mapIndexed { i, longer ->
                Polyline.encode(listOf(Polyline.Point(37.5, 127.0 + i * 0.1), Polyline.Point(37.5 + if (longer) 0.05 else 0.005, 127.0 + i * 0.1)))
            }
            val length = segments.sumOf { Polyline.lengthM(Polyline.decode(it, 10)) }
            val ceiling = seconds * ActualRouteService.MAX_SPEED_MPS
            val upload = RouteDayUpload(segments, reported, 100, null, now.minusSeconds(seconds), now)
            if (length > ceiling) {
                // 폴리라인 자체가 물리 상한을 넘으면 받지 않는다 — 하한이 상한을 이기게 두면 터무니없는 값이 고착된다
                shouldThrow<ValidationFailed> { w.service().store(acc, tripId, day, upload) }
                w.routes.rows.size shouldBe 0
            } else {
                val saved = w.service().store(acc, tripId, day, upload)
                saved.distanceM shouldBeGreaterThanOrEqual kotlin.math.ceil(length).toInt()
                saved.distanceM.toDouble() shouldBeLessThanOrEqual0 ceiling + 1
                saved.distanceClamped shouldBe (saved.distanceM != reported)
            }
        }
    }

    /** PBT-U10-1 — 철회 뒤 L3 가 꺼진 계정에는 행이 0개이고, 지운 건수 > 0 일 때만 파기 로그가 정확히 1건 는다. */
    "철회하면 그 계정의 경로를 전부 지우고, 지운 것이 있을 때만 파기를 남긴다" {
        checkAll(Arb.list(Arb.element("store", "revoke", "redeliver", "optIn"), 0..12)) { ops ->
            val w = World()
            val svc = w.service()
            var expectedPurges = 0
            ops.forEachIndexed { i, op ->
                when (op) {
                    "store" -> runCatching { svc.store(acc, tripId, LocalDate.parse("2026-08-10").plusDays((i % 3).toLong()), upload()) }
                    "optIn" -> w.consents.gps = true
                    else -> {
                        if (op == "revoke") w.consents.gps = false
                        val before = w.routes.rows.size
                        svc.purge(acc)
                        if (before > 0) expectedPurges++
                    }
                }
                if (!w.consents.gps && op != "store") w.routes.rows.size shouldBe 0
            }
            w.logs.purged.size shouldBe expectedPurges
            w.logs.purged.all { it.first == LocationPurgeScope.ACTUAL_ROUTE && it.second > 0 } shouldBe true
        }
    }
})

/** 테스트용 인코더(Google 형식, 1e-5). 서버는 풀기만 한다 — 인코딩은 기기 몫이라 본 코드에 두지 않는다. */
internal fun Polyline.encode(points: List<Polyline.Point>): String {
    val out = StringBuilder()
    var lat = 0
    var lng = 0
    fun put(v: Int) {
        var x = if (v < 0) (v shl 1).inv() else v shl 1
        while (x >= 0x20) { out.append(((0x20 or (x and 0x1f)) + 63).toChar()); x = x shr 5 }
        out.append((x + 63).toChar())
    }
    for (p in points) {
        val la = Math.round(p.lat * 1e5).toInt()
        val ln = Math.round(p.lng * 1e5).toInt()
        put(la - lat); put(ln - lng)
        lat = la; lng = ln
    }
    return out.toString()
}
