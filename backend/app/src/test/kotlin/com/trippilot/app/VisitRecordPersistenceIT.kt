package com.trippilot.app

import com.trippilot.archive.application.AddVisitPhoto
import com.trippilot.archive.application.VisitRecordService
import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.VisitCheck
import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.auth.application.LocationConsentService
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 방문 사진 메타·메모 실 DB 검증(TRIP-542 · V2.33·V2.34).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **INV-U5-04 좌표 차단이 실제 동의 상태와 물려 있는지** — 대역은 불리언 하나라 배선이 끊겨도 통과한다
 * - **같은 자산 중복 UNIQUE** — 앱이 놓쳐도 DB 가 막는다
 * - **메모 PK 가 한 방문 한 개를 보장** — Map 대역은 언제나 덮어써 이 성질이 존재하지 않는다
 * - **CASCADE 파기** — 방문이 지워지면 사진·메모도 함께 간다(BR-U5-52). 앱 롤에 DELETE 가 있어야 성립한다
 * - **`created_at` 이 upsert 로 밀리지 않는지** — JPA save 였다면 갱신 시각으로 덮인다
 */
@SpringBootTest
class VisitRecordPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var records: VisitRecordService
    @Autowired private lateinit var checks: VisitCheckRepository
    @Autowired private lateinit var locationConsents: LocationConsentService
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-08-11T01:00:00Z")

    private fun newAccount(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    private fun newTrip(accountId: UUID): UUID = trips.save(
        Trip.create(
            accountId = accountId, title = null,
            startDate = LocalDate.parse("2026-08-10"), endDate = LocalDate.parse("2026-08-12"),
            party = 2, companionType = null, budgetTotal = null,
            preferenceSnapshot = emptyMap(),
            destinations = listOf(TripDestination(0, "제주", 2)), now = now,
        ),
    ).tripId

    private fun newVisit(tripId: UUID): UUID = checks.save(
        VisitCheck.arrive(tripId, "2026-08-11#${UUID.randomUUID()}", UUID.randomUUID(), CheckSource.MANUAL, now),
    ).visitCheckId

    private fun photo(assetId: String, lat: Double? = 33.45, lng: Double? = 126.57) =
        AddVisitPhoto(assetId, "device-1", now, lat, lng, null)

    @Test
    fun `위치 동의를 켜야 좌표가 저장된다 — 배선이 실제 동의 상태와 물려 있다(INV-U5-04)`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val visit = newVisit(tripId)

        // 기본값은 미동의다 — 동의는 명시적으로만 생긴다.
        val denied = records.addPhoto(accountId, tripId, visit, photo("asset-denied"))
        denied.exifLat shouldBe null
        jdbc.queryForObject(
            "SELECT exif_lat IS NULL AND exif_lng IS NULL FROM visit_photo_meta WHERE visit_photo_meta_id = ?",
            Boolean::class.java, denied.visitPhotoMetaId,
        ) shouldBe true

        // 대조군 — 동의를 켜면 같은 요청이 좌표를 남긴다. 이게 없으면 "항상 null"로도 통과한다.
        locationConsents.update(AccountId(accountId), legalConsent = true, gpsRecordingOptIn = true)
        val granted = records.addPhoto(accountId, tripId, visit, photo("asset-granted"))
        granted.exifLat shouldBe 33.45
        granted.exifLng shouldBe 126.57
    }

    @Test
    fun `같은 기기의 같은 자산은 한 방문에 한 번만 붙는다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val visit = newVisit(tripId)
        records.addPhoto(accountId, tripId, visit, photo("same-asset"))

        shouldThrow<DataIntegrityViolationException> {
            records.addPhoto(accountId, tripId, visit, photo("same-asset"))
        }

        // 다른 방문에는 같은 자산을 붙일 수 있다 — 제약은 방문 단위다.
        records.addPhoto(accountId, tripId, newVisit(tripId), photo("same-asset"))
    }

    @Test
    fun `메모는 한 방문에 하나 — 다시 쓰면 덮이고 created_at 은 밀리지 않는다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val visit = newVisit(tripId)

        records.putMemo(accountId, tripId, visit, "처음")
        val createdAt = jdbc.queryForObject(
            "SELECT created_at FROM visit_memo WHERE visit_check_id = ?", Instant::class.java, visit,
        )
        records.putMemo(accountId, tripId, visit, "고침")

        jdbc.queryForObject("SELECT count(*) FROM visit_memo WHERE visit_check_id = ?", Int::class.java, visit) shouldBe 1
        records.findMemo(accountId, tripId, visit)!!.text shouldBe "고침"
        // JPA save 였다면 행을 통째로 덮어써 "언제 처음 썼나"가 사라진다.
        jdbc.queryForObject(
            "SELECT created_at FROM visit_memo WHERE visit_check_id = ?", Instant::class.java, visit,
        ) shouldBe createdAt
    }

    @Test
    fun `방문을 지우면 사진·메모가 함께 파기된다 — 앱 롤에 DELETE 가 있다(BR-U5-52)`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val visit = newVisit(tripId)
        records.addPhoto(accountId, tripId, visit, photo("a"))
        records.addPhoto(accountId, tripId, visit, photo("b"))
        records.putMemo(accountId, tripId, visit, "감상")

        // append-only 테이블이 아니다 — 앱 롤이 직접 지울 수 있어야 한다.
        jdbc.update("DELETE FROM visit_check WHERE visit_check_id = ?", visit) shouldBe 1

        jdbc.queryForObject(
            "SELECT count(*) FROM visit_photo_meta WHERE visit_check_id = ?", Int::class.java, visit,
        ) shouldBe 0
        jdbc.queryForObject(
            "SELECT count(*) FROM visit_memo WHERE visit_check_id = ?", Int::class.java, visit,
        ) shouldBe 0
    }

    @Test
    fun `사진이 0장이어도 메모는 남고, 방문별 개수는 정확하다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val withPhotos = newVisit(tripId)
        val withoutPhotos = newVisit(tripId)
        records.addPhoto(accountId, tripId, withPhotos, photo("a"))
        records.addPhoto(accountId, tripId, withPhotos, photo("b"))
        records.putMemo(accountId, tripId, withoutPhotos, "사진 없이 남기는 감상")

        val counts = records.photoCountsByVisit(accountId, tripId)

        counts[withPhotos] shouldBe 2
        // 0장인 방문은 키 자체가 없다 — GROUP BY 는 없는 행을 만들지 않는다. 소비자가 0으로 읽어야 한다.
        counts[withoutPhotos] shouldBe null
        records.listPhotos(accountId, tripId, withoutPhotos) shouldBe emptyList()
        records.findMemo(accountId, tripId, withoutPhotos)!!.text shouldBe "사진 없이 남기는 감상"
    }
}
