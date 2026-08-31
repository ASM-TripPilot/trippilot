package com.trippilot.trip.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.trip.domain.Trip
import com.trippilot.placedata.api.DestinationCheck
import com.trippilot.placedata.api.DestinationFacade
import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

private class FakeRepo : TripRepository {
    val store = mutableMapOf<UUID, Trip>()
    override fun save(trip: Trip) = trip.also { store[it.tripId] = it }
    override fun findById(tripId: UUID) = store[tripId]
    override fun findByAccount(accountId: UUID) = store.values.filter { it.accountId == accountId }
}

class TripServiceTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-07-26T00:00:00Z"), ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val other = UUID.randomUUID()

    fun cmd(
        start: String = "2026-08-01", end: String = "2026-08-04", party: Int = 2,
        dests: List<TripDestination> = listOf(TripDestination(0, "제주", 3)),
    ) = CreateTripCommand(null, LocalDate.parse(start), LocalDate.parse(end), party, null, null, mapOf("pace" to "알차게"), dests)

    "생성 후 소유자 조회·목록(제목 자동생성·취향 동결)" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), clock)
        val t = svc.create(acc, cmd())
        t.title shouldBe "제주 여행"
        t.preferenceSnapshot["pace"] shouldBe "알차게"
        svc.get(acc, t.tripId).party shouldBe 2
        svc.list(acc).size shouldBe 1
    }

    "타 계정 리소스는 404" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), clock)
        val t = svc.create(acc, cmd())
        shouldThrow<ResourceNotFound> { svc.get(other, t.tripId) }
    }

    "국내 밖 목적지는 400(INV-U1-12)" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), clock)
        shouldThrow<ValidationFailed> { svc.create(acc, cmd(dests = listOf(TripDestination(0, "도쿄", 2)))) }
    }

    // 이전 구현은 지역명 28개와 문자열 일치를 봤다 — 아래가 전부 막혔다(실측).
    "목록에 없던 시·군·구도 국내로 통과한다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), clock)
        listOf("천안", "속초시", "사하구").forEach { region ->
            svc.create(acc, cmd(dests = listOf(TripDestination(0, region, 2)))).tripId
        }
    }

    /**
     * **정책이 바뀐 자리다(TRIP-360).** 예전에는 확인 못 하면 통과시켰다 — 지오코딩이 유일한 기준이라
     * 벤더 장애가 곧 전면 차단이었기 때문이다. 이제 정상 목적지는 카탈로그에서 끝나 외부를 타지 않으므로,
     * "확인 못 함"까지 온 값은 어차피 지원하지 않는 이름이다. 거절하되 사유를 그렇게 말한다.
     *
     * 벤더 장애가 정상 사용자를 막지 않는다는 보장은 위 "목록에 없던 시·군·구도 통과한다" 가 맡는다 —
     * 그쪽이 카탈로그 경로라 외부를 부르지 않는다.
     */
    "확인하지 못한 목적지는 거절한다" {
        val svc = TripService(FakeRepo(), FakeDomestic(down = true), FakeRegions(), clock)
        val e = shouldThrow<ValidationFailed> {
            svc.create(acc, cmd(dests = listOf(TripDestination(0, "어딘가", 2))))
        }
        // 문구가 사유를 구분해야 한다 — "국내만 지원해요" 로 뭉치면 사용자는 무엇을 고칠지 모른다.
        e.fieldErrors.single().reason shouldContain "확인하지 못했어요"
    }

    "거절 문구가 사유별로 갈린다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), clock)
        val e = shouldThrow<ValidationFailed> {
            svc.create(acc, cmd(dests = listOf(TripDestination(0, "도쿄", 2))))
        }
        e.fieldErrors.single().reason shouldContain "국내 여행만"
    }

    "여러 목적지 중 하나만 국외여도 막는다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), clock)
        shouldThrow<ValidationFailed> {
            svc.create(acc, cmd(dests = listOf(TripDestination(0, "제주", 1), TripDestination(1, "도쿄", 1))))
        }
    }

    "종료일 < 시작일은 400(INV-U1-11)" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), clock)
        shouldThrow<ValidationFailed> { svc.create(acc, cmd(start = "2026-08-04", end = "2026-08-01")) }
    }

    "도시 박수 합이 기간 초과면 400(INV-U1-14)" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), clock)
        // 3박4일인데 제주 3 + 부산 2 = 5박 > 3
        shouldThrow<ValidationFailed> {
            svc.create(acc, cmd(dests = listOf(TripDestination(0, "제주", 3), TripDestination(1, "부산", 2))))
        }
    }

    "편집은 가변필드 대체" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), clock)
        val t = svc.create(acc, cmd())
        val edited = svc.edit(acc, t.tripId, EditTripCommand("내 여행", LocalDate.parse("2026-08-01"), LocalDate.parse("2026-08-03"), 4, null, null, listOf(TripDestination(0, "부산", 2))))
        edited.title shouldBe "내 여행"
        edited.party shouldBe 4
        edited.destinations.single().region shouldBe "부산"
    }

    // ── 행정구역 표준코드 채우기(TRIP-361) ─────────────────────────────────────
    "확정되는 지역명은 표준코드가 채워진다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), clock)

        val t = svc.create(acc, cmd(dests = listOf(TripDestination(0, "제주", 3))))

        t.destinations.single().regionCode shouldBe "50"
    }

    "별칭으로 들어와도 같은 코드로 모인다 — 표기 흔들림이 저장에 남지 않는다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), clock)

        // 사용자가 '제주도'라고 골라도 저장되는 코드는 '제주'와 같아야 한다.
        val t = svc.create(acc, cmd(dests = listOf(TripDestination(0, "제주도", 3))))

        t.destinations.single().regionCode shouldBe "50"
        t.destinations.single().region shouldBe "제주도"   // 표시는 사용자가 고른 그대로다
    }

    /**
     * 이 테스트가 이 칸의 핵심이다. 중구는 다섯 곳이라 이름만으로는 정할 수 없다 —
     * 하나를 집으면 부산 중구를 고른 사용자에게 서울 중구가 조용히 박힌다.
     */
    "동명이지역은 코드를 비운다 — 임의로 하나 집지 않는다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), clock)

        val t = svc.create(acc, cmd(dests = listOf(TripDestination(0, "중구", 3))))

        t.destinations.single().regionCode shouldBe null
    }

    "편집해도 코드가 사라지지 않는다 — 생성만 채우면 편집이 지운다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), clock)
        val t = svc.create(acc, cmd(dests = listOf(TripDestination(0, "제주", 3))))

        // 클라이언트는 코드를 보내지 않는다(계약 불변) — 편집 입력의 regionCode 는 항상 null 이다.
        val edited = svc.edit(
            acc, t.tripId,
            EditTripCommand(
                "내 여행", LocalDate.parse("2026-08-01"), LocalDate.parse("2026-08-03"), 4, null, null,
                listOf(TripDestination(0, "부산", 2)),
            ),
        )

        edited.destinations.single().regionCode shouldBe "26"
    }

    "소프트삭제 후 조회 404 · 목록 제외" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), clock)
        val t = svc.create(acc, cmd())
        svc.delete(acc, t.tripId)
        shouldThrow<ResourceNotFound> { svc.get(acc, t.tripId) }
        svc.list(acc).size shouldBe 0
    }
})

/** 목적지 판정 대역 — 카탈로그에 있는 것만 받는다. [down] 이면 확인 불가. */
private class FakeDomestic(private val down: Boolean = false) : DestinationFacade {
    override fun check(region: String): DestinationCheck = when {
        down -> DestinationCheck.UNVERIFIED
        // '제주도'는 별칭, '중구'는 카탈로그에 다섯 곳 — 실 카탈로그에서 둘 다 SUPPORTED 다.
        region in setOf("제주", "제주도", "부산", "천안", "속초시", "사하구", "중구") -> DestinationCheck.SUPPORTED
        else -> DestinationCheck.OUTSIDE
    }
}

/**
 * 지역 코드 조회 대역 — **동명이지역을 실제로 재현한다**. '사하구' 는 하나지만 '중구' 는 여럿이라
 * 코드가 확정되지 않는다. 하나만 돌려주는 대역을 쓰면 `singleOrNull` 가드가 아무것도 안 지킨다.
 */
private class FakeRegions : RegionLookupFacade {
    override fun codesOf(regionName: String): List<String> = when (regionName) {
        "제주" -> listOf("50")
        "제주도" -> listOf("50")   // 별칭도 같은 코드로 모인다
        "부산" -> listOf("26")
        "사하구" -> listOf("26380")
        "중구" -> listOf("11140", "26170", "27110")  // 동명이지역
        else -> emptyList()
    }

    override fun centerOf(regionName: String): RegionCenter? = null
}
