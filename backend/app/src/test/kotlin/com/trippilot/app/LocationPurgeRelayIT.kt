package com.trippilot.app

import com.trippilot.app.event.OutboxRelay
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
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 위치 동의 철회 → **저장된 EXIF 좌표 파기**의 관통 검증(INV-L4).
 *
 * ## 왜 따로 있나 — 양 끝이 아니라 **사이**를 잰다
 *
 * 발행하는 쪽(`LocationConsentService`)과 지우는 쪽(`GpsRecordingOptOutSubscriber`)은 각각 모듈
 * 테스트가 대역으로 잠그고 있다. 그런데 **둘을 잇는 구간은 어느 쪽에도 없다** — 이벤트 타입
 * 문자열(`auth.GpsRecordingOptOut`)이 양쪽에 각자 리터럴로 박혀 있고, 구독자가 빈으로 잡히는지도
 * 앱 컨텍스트에서만 드러난다.
 *
 * 어긋났을 때가 고약하다. 릴레이는 듣는 이가 없는 이벤트를 **`INFO` 한 줄 남기고 닫는다**
 * ("구독자 없는 이벤트 N건을 닫았습니다"). 예외도 실패도 아니라서 초록이고, 좌표는 남는다.
 * 법적 파기 의무에서 가장 조용한 실패 모양이라 여기서 못을 박는다.
 *
 * 그래서 `purgeExifCoordinates` 를 직접 부르지 않고 **동의 철회에서 출발한다.** 그래야
 * 아웃박스 적재·릴레이 배달·구독자 배선이 전부 경로에 들어온다.
 */
@SpringBootTest
class LocationPurgeRelayIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var records: VisitRecordService
    @Autowired private lateinit var checks: VisitCheckRepository
    @Autowired private lateinit var locationConsents: LocationConsentService
    @Autowired private lateinit var relay: OutboxRelay
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-08-11T01:00:00Z")

    @Test
    fun `동의를 철회하면 릴레이를 지나 좌표가 지워지고 파기 사실이 남는다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val visit = newVisit(tripId)
        locationConsents.update(AccountId(accountId), legalConsent = true, gpsRecordingOptIn = true)
        val photo = records.addPhoto(accountId, tripId, visit, photo("asset-purge"))

        // 전제 — 지울 것이 실제로 있어야 이 테스트가 무언가를 말한다. 없으면 "항상 null" 로도 통과한다.
        exifLat(photo.visitPhotoMetaId) shouldBe 33.45
        purgeLogs(accountId) shouldBe 0

        locationConsents.update(AccountId(accountId), legalConsent = null, gpsRecordingOptIn = false)

        // 같은 컨테이너를 쓰는 다른 IT 의 릴레이가 내 행을 먼저 집어갈 수 있다 — 한 번만 부르면
        // 내 호출은 빈 배치를 보고 지나간다. 결과가 보일 때까지 돌린다(이 리포의 관용구).
        repeat(RELAY_TRIES) { if (exifLat(photo.visitPhotoMetaId) != null) relay.relay() }

        exifLat(photo.visitPhotoMetaId) shouldBe null
        // 행 자체는 남는다 — 좌표만 지운다.
        jdbc.queryForObject(
            "SELECT count(*) FROM visit_photo_meta WHERE visit_photo_meta_id = ?",
            Int::class.java, photo.visitPhotoMetaId,
        ) shouldBe 1
        // 파기 사실이 확인자료에 남았는가. `event_type` CHECK 어휘(`PURGE`)도 여기서 함께 잠긴다 —
        // 어휘가 어긋나면 append 가 통째로 실패한다.
        purgeLogs(accountId) shouldBe 1
        jdbc.queryForObject(
            """
            SELECT detail->>'purgedCount' FROM location_legal_log
             WHERE account_id = ? AND event_type = 'PURGE' AND detail->>'scope' = 'PHOTO_EXIF'
            """.trimIndent(),
            String::class.java, accountId,
        ) shouldBe "1"
    }

    /**
     * 지울 것이 없으면 **기록도 남지 않는다.** 재배달(at-least-once)마다 0건 기록이 쌓이면
     * 확인자료가 "지운 적 없는 것을 지웠다"고 말하게 된다.
     */
    @Test
    fun `지울 좌표가 없으면 파기 기록을 남기지 않는다`() {
        val accountId = newAccount()
        newTrip(accountId) // 여행은 있으나 사진이 없다

        locationConsents.update(AccountId(accountId), legalConsent = true, gpsRecordingOptIn = true)
        locationConsents.update(AccountId(accountId), legalConsent = null, gpsRecordingOptIn = false)

        // **이벤트가 실제로 배달될 때까지만** 돌린다. 두 가지를 동시에 얻는다:
        // (1) 무조건 N 번 돌리면 같은 컨테이너를 쓰는 다른 IT 의 미발행 행까지 집어가
        //     그쪽 시도 횟수 단정을 흔든다 — 이 리포가 이미 겪은 간섭이다.
        // (2) 아래 단정이 **구독자가 한 번도 안 돌아도 0 이라** 공허해진다. 배달을 확인하고 나서
        //     0 을 봐야 "지울 것이 없어서 안 남았다"가 된다.
        repeat(RELAY_TRIES) { if (optOutEvents(accountId, published = false) > 0) relay.relay() }

        // **"배달됐다"를 세지 "안 남았다"를 세지 않는다.** 미발행 0 으로 확인하면 이벤트가 아예
        // 발행되지 않은 경우에도 0 이라 그대로 통과한다(실측 — 변이로 걸렸다). 발행분이 1 이어야
        // 아래 단정이 "구독자가 돌았는데 지울 것이 없었다"를 뜻한다.
        optOutEvents(accountId, published = true) shouldBe 1

        purgeLogs(accountId) shouldBe 0
    }

    /** 이 계정의 철회 이벤트 수. [published] 로 배달 완료분과 대기분을 가른다. */
    private fun optOutEvents(accountId: UUID, published: Boolean): Int = jdbc.queryForObject(
        """
        SELECT count(*) FROM outbox_event
         WHERE event_type = 'auth.GpsRecordingOptOut' AND aggregate_id = ?
           AND published_at IS ${if (published) "NOT NULL" else "NULL"}
        """.trimIndent(),
        Int::class.java, accountId.toString(),
    )!!

    private fun exifLat(photoId: UUID): Double? = jdbc.queryForObject(
        "SELECT exif_lat FROM visit_photo_meta WHERE visit_photo_meta_id = ?", Double::class.java, photoId,
    )

    /** `PHOTO_EXIF` scope 만 센다 — 철회는 `gps_track` 파기 로그도 함께 남기므로 총 건수로는 못 가른다. */
    private fun purgeLogs(accountId: UUID): Int = jdbc.queryForObject(
        """
        SELECT count(*) FROM location_legal_log
         WHERE account_id = ? AND event_type = 'PURGE' AND detail->>'scope' = 'PHOTO_EXIF'
        """.trimIndent(),
        Int::class.java, accountId,
    )!!

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

    private fun photo(assetId: String) = AddVisitPhoto(assetId, "device-1", now, 33.45, 126.57, null)

    private companion object {
        /** 남의 릴레이 호출에 내 행을 빼앗겨도 결국 결과를 보게 하는 상한. */
        private const val RELAY_TRIES = 20
    }
}
