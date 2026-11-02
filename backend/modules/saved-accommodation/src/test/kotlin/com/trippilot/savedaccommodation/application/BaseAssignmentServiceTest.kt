package com.trippilot.savedaccommodation.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.core.error.ValidationFailed
import com.trippilot.savedaccommodation.domain.BaseAssignment
import com.trippilot.savedaccommodation.domain.BaseAssignmentRepository
import com.trippilot.savedaccommodation.domain.CoverageStatus
import com.trippilot.savedaccommodation.domain.GeocodeCandidate
import com.trippilot.savedaccommodation.domain.PlaceSearchPort
import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.savedaccommodation.domain.SavedStay
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

private class FakeBases : BaseAssignmentRepository {
    val store = mutableMapOf<UUID, BaseAssignment>()
    override fun save(base: BaseAssignment) = base.also { store[it.baseAssignmentId] = it }
    override fun findByTrip(tripId: UUID) = store.values.filter { it.tripId == tripId }
    override fun findById(baseAssignmentId: UUID) = store[baseAssignmentId]
    override fun delete(base: BaseAssignment) { store.remove(base.baseAssignmentId) }
    override fun existsByStayId(savedStayId: UUID) = store.values.any { it.savedStayId == savedStayId }
    override fun deleteByStayId(savedStayId: UUID) = error("이 테스트는 배정 정리를 쓰지 않는다")
    override fun findTripIdsByStays(savedStayIds: Collection<UUID>) =
        store.values.filter { it.savedStayId in savedStayIds }
            .groupBy { it.savedStayId }
            .mapValues { (_, rows) -> rows.map { r -> r.tripId }.distinct() }
}

private class FakeStays : SavedStayRepository {
    val store = mutableMapOf<UUID, SavedStay>()
    override fun save(stay: SavedStay) = stay.also { store[it.savedStayId] = it }
    override fun findById(savedStayId: UUID) = store[savedStayId]
    override fun findByAccount(accountId: UUID) = store.values.filter { it.accountId == accountId }
    override fun delete(stay: SavedStay) { store.remove(stay.savedStayId) }
    override fun existsByAccountAndExternal(accountId: UUID, externalSource: String, externalId: String) =
        error("이 테스트는 중복 선검사를 쓰지 않는다")
}

/** (acc,tripId) → period 를 등록해두면 소유로 간주. 미등록은 null(404). [destinationCodes] = 목적지 코드(null 이면 목적지 없음). */
private class FakeTrips : TripFacade {
    val periods = mutableMapOf<Pair<UUID, UUID>, TripPeriod>()
    var destinationCodes: List<String?>? = null
    override fun findPeriod(accountId: UUID, tripId: UUID) = periods[accountId to tripId]
    override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? {
        val p = periods[accountId to tripId] ?: return null
        val codes = destinationCodes ?: return null
        return TripGenerationContext(
            p.startDate, p.endDate, codes.map { TripDestinationRef("목적지", it, 3) }, null, null, emptyList(),
        )
    }
}

/** 좌표 → 주소. [down] 이면 벤더 장애. 위도 35 근처 = 부산, 그 밖 = 서울로 둔다. */
private class FakePlaceSearch : PlaceSearchPort {
    var down = false
    override fun geocode(query: String): List<GeocodeCandidate> = emptyList()
    override fun reverseGeocode(lat: Double, lng: Double): String? {
        if (down) throw UpstreamUnavailable(source = "kakao", fallbackApplied = false)
        return if (lat < 36.0) "부산광역시 동구 초량동" else "서울특별시 종로구 세종로"
    }
}

/** 주소 첫 토큰 → 시도 코드(부산 26 · 서울 11). 그 밖은 null(판정 불가). */
private class FakeRegions : RegionLookupFacade {
    override fun codesOf(regionName: String) = emptyList<String>()
    override fun isSelectableCode(regionCode: String) = true
    override fun centerOf(regionName: String): RegionCenter? = null
    override fun centerOfCode(regionCode: String): RegionCenter? = null
    override fun codeOfAddress(address: String): String? = when (address.substringBefore(' ')) {
        "부산광역시" -> "26"
        "서울특별시" -> "11"
        else -> null
    }
}

class BaseAssignmentServiceTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-07-26T00:00:00Z"), ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val other = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-01")
    val end = LocalDate.parse("2026-08-04")

    val trips = FakeTrips()
    val placeSearch = FakePlaceSearch()

    fun fixture(): Triple<BaseAssignmentService, FakeStays, Pair<UUID, UUID>> {
        val stays = FakeStays()
        val tripId = UUID.randomUUID()
        trips.periods[acc to tripId] = TripPeriod(start, end)
        trips.destinationCodes = null
        placeSearch.down = false
        val svc = BaseAssignmentService(
            FakeBases(), stays, trips, FakeTripBaseDays(), CapturingEvents(), clock, placeSearch, FakeRegions(),
        )
        return Triple(svc, stays, acc to tripId)
    }

    fun stayAt(stays: FakeStays, lat: Double, lng: Double): UUID =
        stays.save(
            SavedStay.register(acc, "숙소", lat, lng, true, null, null, null, null, RegisterRoute.PIN, null, clock.instant()),
        ).savedStayId

    fun stay(stays: FakeStays, owner: UUID): UUID =
        stays.save(
            SavedStay.register(owner, "숙소", 37.5, 127.0, true, null, null, null, null, RegisterRoute.PIN, null, clock.instant()),
        ).savedStayId

    fun cmd(stayId: UUID, from: String = "2026-08-01", to: String = "2026-08-04") =
        AssignBaseCommand(stayId, LocalDate.parse(from), LocalDate.parse(to))

    "거점 배정 후 목록 조회" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, acc)
        svc.assign(acc, t.second, cmd(s))
        svc.list(acc, t.second).single().savedStayId shouldBe s
    }

    "타 계정 여행이면 404" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, acc)
        shouldThrow<ResourceNotFound> { svc.assign(other, t.second, cmd(s)) }
    }

    "타 계정 숙소로 거점 배정은 404" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, other)
        shouldThrow<ResourceNotFound> { svc.assign(acc, t.second, cmd(s)) }
    }

    "좌표 미확정 숙소는 거점 배정 불가 400(INV-U1-08)" {
        val (svc, stays, t) = fixture()
        val unconfirmed = stays.save(
            SavedStay.register(acc, "미확정", null, null, false, null, null, null, null, RegisterRoute.LINK_PASTE, null, clock.instant()),
        ).savedStayId
        shouldThrow<ValidationFailed> { svc.assign(acc, t.second, cmd(unconfirmed)) }
    }

    /**
     * 기간 밖은 거부한다(INV-U1-15) — 서버가 여행 기간을 늘려 주지 않는다(US-TRIP-03 예외는 클라 2단계).
     * 그래서 **어느 쪽이 왜 벗어났는지**가 오류에 담겨야 화면이 "기간을 늘릴까요?"를 그릴 수 있다.
     */
    "여행 종료일을 넘긴 구간은 400 — 종료일 칸에 여행 종료일을 담아 알린다" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, acc)

        val thrown = shouldThrow<ValidationFailed> { svc.assign(acc, t.second, cmd(s, "2026-08-01", "2026-08-05")) }

        val error = thrown.fieldErrors.single()
        error.field shouldBe "dateTo" // 시작일 칸을 지목하면 사용자가 엉뚱한 값을 고친다
        error.reason shouldContain "2026-08-04" // 화면이 "여행은 8/4까지예요"를 그릴 근거
    }

    "여행 시작일보다 앞선 구간은 시작일 칸으로 알린다" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, acc)

        val thrown = shouldThrow<ValidationFailed> { svc.assign(acc, t.second, cmd(s, "2026-07-30", "2026-08-02")) }

        val error = thrown.fieldErrors.single()
        error.field shouldBe "dateFrom"
        error.reason shouldContain "2026-08-01"
    }

    "양쪽 다 벗어나면 둘 다 알린다 — 하나씩 고치고 다시 막히지 않게" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, acc)

        val thrown = shouldThrow<ValidationFailed> { svc.assign(acc, t.second, cmd(s, "2026-07-30", "2026-08-09")) }

        thrown.fieldErrors.map { it.field } shouldContainExactly listOf("dateFrom", "dateTo")
    }

    "이어붙은 구간 거점이면 커버리지 비차단" {
        val (svc, stays, t) = fixture()
        val s1 = stay(stays, acc)
        val s2 = stay(stays, acc)
        svc.assign(acc, t.second, cmd(s1, "2026-08-01", "2026-08-03"))
        svc.assign(acc, t.second, cmd(s2, "2026-08-03", "2026-08-04"))
        val cov = svc.coverage(acc, t.second)
        cov.blocked shouldBe false
        cov.days.map { it.status }.toSet() shouldBe setOf(CoverageStatus.AUTO)
    }

    "공백일이 있으면 커버리지 차단" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, acc)
        svc.assign(acc, t.second, cmd(s, "2026-08-01", "2026-08-03")) // 8/3 공백
        svc.coverage(acc, t.second).blocked shouldBe true
    }

    "거점 삭제 후 목록 제외" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, acc)
        val base = svc.assign(acc, t.second, cmd(s))
        svc.remove(acc, t.second, base.baseAssignmentId)
        svc.list(acc, t.second).size shouldBe 0
    }

    "다른 여행의 거점 id 삭제는 404" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, acc)
        svc.assign(acc, t.second, cmd(s))
        shouldThrow<ResourceNotFound> { svc.remove(acc, t.second, UUID.randomUUID()) }
    }

    // TRIP-1703 — 서울 1박 여행에 부산 숙소를 거점으로 붙이면 1일차가 부산에서 돌았다(872km).
    "서울 여행에 부산 숙소를 거점으로 붙이면 409 STAY_OUTSIDE_TRIP_REGION — 앱이 이 코드로 안내한다" {
        val (svc, stays, t) = fixture()
        trips.destinationCodes = listOf("11110") // 서울 종로구
        val busan = stayAt(stays, 35.11, 129.04)

        val thrown = shouldThrow<ConflictDetected> { svc.assign(acc, t.second, cmd(busan)) }

        thrown.errorCode shouldBe ErrorCode.STAY_OUTSIDE_TRIP_REGION
        svc.list(acc, t.second).size shouldBe 0
    }

    "목적지가 구(5자리)여도 같은 시도 숙소 코드(2자리)는 지역 안이다 — 양방향 접두사(INV-U1-21)" {
        val (svc, stays, t) = fixture()
        trips.destinationCodes = listOf("11110")
        svc.assign(acc, t.second, cmd(stayAt(stays, 37.57, 126.97)))
        svc.list(acc, t.second).size shouldBe 1
    }

    "다목적지 여행은 목적지 하나에라도 들면 지역 안이다" {
        val (svc, stays, t) = fixture()
        trips.destinationCodes = listOf("11", "26")
        svc.assign(acc, t.second, cmd(stayAt(stays, 35.11, 129.04)))
        svc.list(acc, t.second).size shouldBe 1
    }

    "판정할 수 없으면 막지 않는다 — 목적지 코드 누락·주소 조회 장애(fail-open, INV-U1-21)" {
        val (svc, stays, t) = fixture()
        trips.destinationCodes = listOf("11", null)
        svc.assign(acc, t.second, cmd(stayAt(stays, 35.11, 129.04)))

        trips.destinationCodes = listOf("11")
        placeSearch.down = true
        svc.assign(acc, t.second, cmd(stayAt(stays, 35.11, 129.04)))

        svc.list(acc, t.second).size shouldBe 2
    }
})
