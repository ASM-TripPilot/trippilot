package com.trippilot.app

import com.trippilot.app.export.AccountExportService
import com.trippilot.archive.application.VisitRecordService
import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.VisitCheck
import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.savedaccommodation.domain.SavedStay
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 내 데이터 내려받기 실 DB 검증(TRIP-551).
 *
 * **이 표면의 유일한 안전 요건은 다른 계정 데이터가 한 건도 섞이지 않는 것**이다. 그것은 단위
 * 테스트로 못 본다 — 대역은 애초에 한 계정 것만 들고 있어서, 경계가 끊겨도 통과한다.
 * 그래서 **두 계정을 실제로 심고** 확인한다.
 */
@SpringBootTest
class AccountExportIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var export: AccountExportService
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var stays: SavedStayRepository
    @Autowired private lateinit var checks: VisitCheckRepository
    @Autowired private lateinit var records: VisitRecordService

    private val now = Instant.parse("2026-08-11T01:00:00Z")

    private fun newAccount(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    private fun newTrip(accountId: UUID, title: String): UUID = trips.save(
        Trip.create(
            accountId = accountId, title = title,
            startDate = LocalDate.parse("2026-08-10"), endDate = LocalDate.parse("2026-08-12"),
            party = 2, companionType = null, budgetTotal = null,
            preferenceSnapshot = emptyMap(),
            destinations = listOf(TripDestination(0, "제주", 2)), now = now,
        ),
    ).tripId

    private fun sectionItems(accountId: UUID, section: String): List<Map<String, Any?>> =
        export.export(accountId).sections.single { it.section == section }.items

    @Test
    fun `다른 계정 데이터가 한 건도 섞이지 않는다`() {
        val mine = newAccount()
        val theirs = newAccount()
        val myTrip = newTrip(mine, "내 여행")
        val theirTrip = newTrip(theirs, "남의 여행")
        checks.save(VisitCheck.arrive(myTrip, "2026-08-11#${UUID.randomUUID()}", UUID.randomUUID(), CheckSource.MANUAL, now))
        checks.save(VisitCheck.arrive(theirTrip, "2026-08-11#${UUID.randomUUID()}", UUID.randomUUID(), CheckSource.MANUAL, now))
        stays.save(SavedStay.register(mine, "내 숙소", null, null, false, null, null, null, null, RegisterRoute.PIN, null, now))
        stays.save(SavedStay.register(theirs, "남의 숙소", null, null, false, null, null, null, null, RegisterRoute.PIN, null, now))

        val result = export.export(mine)

        result.accountId shouldBe mine
        val tripTitles = result.sections.single { it.section == "trips" }.items.map { it["title"] }
        tripTitles shouldBe listOf("내 여행")
        val stayNames = result.sections.single { it.section == "savedStays" }.items.map { it["name"] }
        stayNames shouldBe listOf("내 숙소")
        val visitTrips = result.sections.single { it.section == "visits" }.items.map { it["tripId"] }
        visitTrips shouldBe listOf(myTrip.toString())
    }

    @Test
    fun `여섯 몫이 이름순으로 모두 나온다 — 기여자가 빠지면 그 모듈 데이터가 조용히 사라진다`() {
        val accountId = newAccount()

        val sections = export.export(accountId).sections.map { it.section }

        sections shouldBe listOf("consents", "profile", "savedStays", "trips", "visits")
    }

    @Test
    fun `상한을 넘기면 잘라 내고 어느 몫이 잘렸는지 값으로 알린다`() {
        val accountId = newAccount()
        repeat(3) { newTrip(accountId, "여행 $it") }

        val result = export.export(accountId, perSectionLimit = 2)

        result.sectionLimit shouldBe 2
        result.sections.single { it.section == "trips" }.items.size shouldBe 2
        result.sections.single { it.section == "trips" }.truncated shouldBe true
        // 조용히 자르면 사용자는 받은 파일이 전부인 줄 안다.
        result.truncatedSections shouldBe listOf("trips")
    }

    @Test
    fun `상한 안이면 잘렸다고 하지 않는다 — 대조군`() {
        val accountId = newAccount()
        repeat(2) { newTrip(accountId, "여행 $it") }

        val result = export.export(accountId, perSectionLimit = 10)

        result.sections.single { it.section == "trips" }.truncated shouldBe false
        result.truncatedSections shouldBe emptyList()
    }

    @Test
    fun `사진은 바이너리 없이 메타만 나간다(INV-U5-03)`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId, "제주 여행")
        val visit = checks.save(
            VisitCheck.arrive(tripId, "2026-08-11#${UUID.randomUUID()}", UUID.randomUUID(), CheckSource.MANUAL, now),
        )
        records.addPhoto(
            accountId, tripId, visit.visitCheckId,
            com.trippilot.archive.application.AddVisitPhoto("asset-1", "device-1", now, null, null, null),
        )

        val photos = sectionItems(accountId, "visits").single()["photos"] as List<*>

        val photo = photos.single() as Map<*, *>
        photo["localAssetId"] shouldBe "asset-1"
        photo["deviceId"] shouldBe "device-1"
        // 바이너리로 이어지는 칸이 **없다** — 있으면 다음 사이클이 채운다.
        photo.keys.none { (it as String).lowercase().let { k -> "url" in k || "storage" in k || "bytes" in k } } shouldBe true
    }
}
