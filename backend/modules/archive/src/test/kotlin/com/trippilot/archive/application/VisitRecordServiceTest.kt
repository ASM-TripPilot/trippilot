package com.trippilot.archive.application

import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.VisitCheck
import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.archive.domain.VisitMemo
import com.trippilot.archive.domain.VisitMemoRepository
import com.trippilot.archive.domain.VisitPhotoMeta
import com.trippilot.archive.domain.VisitPhotoMetaRepository
import com.trippilot.auth.api.LocationConsentFacade
import com.trippilot.auth.api.LocationLegalLogFacade
import com.trippilot.auth.api.LocationCollectionSource
import com.trippilot.trip.api.TripPurgeScopeFacade
import com.trippilot.auth.api.LocationPurgeScope
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 방문 기록(사진 메타·메모) — BR-U5-11·13 · INV-U5-03·04·05.
 *
 * 가장 중요한 축은 **좌표를 안 받는 것**이다(INV-U5-04). 이건 조용히 틀리는 종류다 — 좌표가 저장돼도
 * 화면은 멀쩡히 돌고, 동의 없이 위치가 쌓였다는 사실은 아무 데도 안 나타난다.
 */
class VisitRecordServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val poi = UUID.randomUUID()
    val now = Instant.parse("2026-08-11T03:00:00Z")
    val clock: Clock = Clock.fixed(now, ZoneOffset.UTC)

    class Checks : VisitCheckRepository {
        val stored = mutableListOf<VisitCheck>()
        override fun save(check: VisitCheck) = check.also {
            stored.removeAll { s -> s.visitCheckId == check.visitCheckId }; stored += it
        }
        override fun findById(visitCheckId: UUID) = stored.firstOrNull { it.visitCheckId == visitCheckId }
        override fun findByTrip(tripId: UUID) = stored.filter { it.tripId == tripId }
        override fun findBySlot(tripId: UUID, slotKey: String) =
            stored.firstOrNull { it.tripId == tripId && it.slotKey == slotKey }
    }

    class Photos : VisitPhotoMetaRepository {
        val stored = mutableListOf<VisitPhotoMeta>()

        /**
         * 파기(INV-L4). 대역은 여행 범위를 모르므로 **보관 중인 좌표 전부**를 지운다 —
         * 범위를 실제로 좁히는지는 실 DB IT 가 본다.
         */
        override fun clearExifCoordinates(tripIds: Collection<UUID>): Int {
            val targets = stored.filter { it.exifLat != null || it.exifLng != null }
            targets.forEach { stored[stored.indexOf(it)] = it.copy(exifLat = null, exifLng = null) }
            return targets.size
        }
        override fun save(photo: VisitPhotoMeta) = photo.also {
            stored.removeAll { p -> p.visitPhotoMetaId == photo.visitPhotoMetaId }; stored += it
        }
        override fun findByVisit(visitCheckId: UUID) =
            stored.filter { it.visitCheckId == visitCheckId }.sortedWith(compareBy({ it.sortOrder }, { it.visitPhotoMetaId }))
        override fun findById(visitPhotoMetaId: UUID) = stored.firstOrNull { it.visitPhotoMetaId == visitPhotoMetaId }
        override fun delete(visitPhotoMetaId: UUID) = stored.removeAll { it.visitPhotoMetaId == visitPhotoMetaId }
        override fun countByVisits(visitCheckIds: Collection<UUID>) =
            stored.filter { it.visitCheckId in visitCheckIds }.groupingBy { it.visitCheckId }.eachCount()
    }

    class Memos : VisitMemoRepository {
        val stored = mutableMapOf<UUID, VisitMemo>()
        override fun upsert(memo: VisitMemo) = memo.also { stored[it.visitCheckId] = it }
        override fun find(visitCheckId: UUID) = stored[visitCheckId]
        override fun findVisitsWithMemo(visitCheckIds: Collection<UUID>) = stored.keys.intersect(visitCheckIds.toSet())
        override fun delete(visitCheckId: UUID) = stored.remove(visitCheckId) != null
    }

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc) TripPeriod(LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12")) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    fun consents(optIn: Boolean) = object : LocationConsentFacade {
        override fun hasGpsRecordingOptIn(accountId: UUID) = optIn
    }

    /** 남긴 수집 사실을 들여다보는 대역 — 법정 로그는 auth 소유라 여기서는 경계 호출만 본다. */
    class LegalLogs : LocationLegalLogFacade {
        val collected = mutableListOf<Triple<UUID, LocationCollectionSource, UUID>>()
        val purged = mutableListOf<Triple<UUID, LocationPurgeScope, Int>>()

        override fun recordCollection(accountId: UUID, source: LocationCollectionSource, subjectId: UUID) {
            collected += Triple(accountId, source, subjectId)
        }

        override fun recordPurge(accountId: UUID, scope: LocationPurgeScope, purgedCount: Int) {
            purged += Triple(accountId, scope, purgedCount)
        }
    }

    class Fixture(
        val svc: VisitRecordService,
        val photos: Photos,
        val memos: Memos,
        val visitCheckId: UUID,
        val legalLogs: LegalLogs,
    )

    fun fixture(gpsOptIn: Boolean = true): Fixture {
        val checks = Checks()
        val photos = Photos()
        val memos = Memos()
        val legalLogs = LegalLogs()
        val purgeScope = object : TripPurgeScopeFacade {
            override fun findAllTripIdsOf(accountId: UUID) = listOf(tripId)
        }
        val visit = checks.save(VisitCheck.arrive(tripId, "2026-08-11#$poi", poi, CheckSource.MANUAL, now))
        return Fixture(
            VisitRecordService(trips, checks, photos, memos, consents(gpsOptIn), legalLogs, purgeScope, clock),
            photos, memos, visit.visitCheckId, legalLogs,
        )
    }

    fun photo(assetId: String = "asset-1", lat: Double? = 33.45, lng: Double? = 126.57, sortOrder: Int? = null) =
        AddVisitPhoto(assetId, "device-1", Instant.parse("2026-08-11T02:00:00Z"), lat, lng, sortOrder)

    // ── INV-U5-04 ──────────────────────────────────────────────────────
    "위치 동의가 없으면 좌표를 보내도 저장되지 않는다(INV-U5-04)" {
        val f = fixture(gpsOptIn = false)

        val saved = f.svc.addPhoto(acc, tripId, f.visitCheckId, photo(lat = 33.45, lng = 126.57))

        saved.exifLat shouldBe null
        saved.exifLng shouldBe null
        // 나머지 메타는 정상 저장된다 — 거부가 아니라 좌표만 버리는 것이다.
        saved.localAssetId shouldBe "asset-1"
        saved.takenAt shouldBe Instant.parse("2026-08-11T02:00:00Z")
    }

    "위치 동의가 있으면 좌표가 그대로 남는다 — 대조군" {
        val f = fixture(gpsOptIn = true)

        val saved = f.svc.addPhoto(acc, tripId, f.visitCheckId, photo(lat = 33.45, lng = 126.57))

        saved.exifLat shouldBe 33.45
        saved.exifLng shouldBe 126.57
    }

    // ── 정렬 ───────────────────────────────────────────────────────────
    "정렬 순서를 주지 않으면 맨 뒤에 붙는다" {
        val f = fixture()
        f.svc.addPhoto(acc, tripId, f.visitCheckId, photo("a"))
        f.svc.addPhoto(acc, tripId, f.visitCheckId, photo("b"))
        f.svc.addPhoto(acc, tripId, f.visitCheckId, photo("c"))

        f.svc.listPhotos(acc, tripId, f.visitCheckId).map { it.localAssetId } shouldBe listOf("a", "b", "c")
    }

    "정렬 변경은 전부를 한 번씩 담아야 한다 — 부분 목록은 거부" {
        val f = fixture()
        val a = f.svc.addPhoto(acc, tripId, f.visitCheckId, photo("a"))
        val b = f.svc.addPhoto(acc, tripId, f.visitCheckId, photo("b"))
        f.svc.addPhoto(acc, tripId, f.visitCheckId, photo("c"))

        // 부분 목록만 다시 매기면 나머지와 순서가 겹쳐 "어느 것이 먼저인가"가 사라진다.
        shouldThrow<ValidationFailed> { f.svc.reorderPhotos(acc, tripId, f.visitCheckId, listOf(a.visitPhotoMetaId, b.visitPhotoMetaId)) }
        // 같은 것을 두 번 담아 개수만 맞춘 목록도 거부한다.
        shouldThrow<ValidationFailed> {
            f.svc.reorderPhotos(acc, tripId, f.visitCheckId, listOf(a.visitPhotoMetaId, a.visitPhotoMetaId, b.visitPhotoMetaId))
        }
        // 실패했으니 순서는 그대로다.
        f.svc.listPhotos(acc, tripId, f.visitCheckId).map { it.localAssetId } shouldBe listOf("a", "b", "c")
    }

    "정렬 변경이 실제로 순서를 바꾼다" {
        val f = fixture()
        val a = f.svc.addPhoto(acc, tripId, f.visitCheckId, photo("a"))
        val b = f.svc.addPhoto(acc, tripId, f.visitCheckId, photo("b"))
        val c = f.svc.addPhoto(acc, tripId, f.visitCheckId, photo("c"))

        f.svc.reorderPhotos(acc, tripId, f.visitCheckId, listOf(c.visitPhotoMetaId, a.visitPhotoMetaId, b.visitPhotoMetaId))

        f.svc.listPhotos(acc, tripId, f.visitCheckId).map { it.localAssetId } shouldBe listOf("c", "a", "b")
    }

    // ── 상한·소유 ──────────────────────────────────────────────────────
    // 시드가 상한보다 적으면 어떤 상한값이어도 통과한다 — 상한만큼 실제로 채우고 그 다음을 잰다.
    "방문당 사진 상한을 넘기면 거부한다" {
        val f = fixture()
        repeat(VisitRecordService.MAX_PHOTOS_PER_VISIT) { f.svc.addPhoto(acc, tripId, f.visitCheckId, photo("asset-$it")) }

        shouldThrow<ValidationFailed> { f.svc.addPhoto(acc, tripId, f.visitCheckId, photo("one-more")) }

        f.svc.listPhotos(acc, tripId, f.visitCheckId).size shouldBe VisitRecordService.MAX_PHOTOS_PER_VISIT
    }

    "타 계정이면 404 — 존재를 알리지 않는다" {
        val f = fixture()
        shouldThrow<ResourceNotFound> { f.svc.addPhoto(UUID.randomUUID(), tripId, f.visitCheckId, photo()) }
        shouldThrow<ResourceNotFound> { f.svc.listPhotos(UUID.randomUUID(), tripId, f.visitCheckId) }
        shouldThrow<ResourceNotFound> { f.svc.putMemo(UUID.randomUUID(), tripId, f.visitCheckId, "메모") }
    }

    "다른 방문의 사진은 지울 수 없다" {
        val f = fixture()
        val mine = f.svc.addPhoto(acc, tripId, f.visitCheckId, photo())

        shouldThrow<ResourceNotFound> { f.svc.removePhoto(acc, tripId, UUID.randomUUID(), mine.visitPhotoMetaId) }
        shouldThrow<ResourceNotFound> { f.svc.removePhoto(acc, tripId, f.visitCheckId, UUID.randomUUID()) }

        f.svc.listPhotos(acc, tripId, f.visitCheckId).size shouldBe 1
    }

    // ── 메모 ───────────────────────────────────────────────────────────
    "메모는 한 방문에 하나 — 다시 쓰면 덮인다(BR-U5-13)" {
        val f = fixture()

        f.svc.putMemo(acc, tripId, f.visitCheckId, "처음")
        f.svc.putMemo(acc, tripId, f.visitCheckId, "  고침  ")

        val memo = f.svc.findMemo(acc, tripId, f.visitCheckId)!!
        memo.text shouldBe "고침" // 앞뒤 공백은 다듬는다
        f.memos.stored.size shouldBe 1
    }

    "사진이 0장이어도 메모·조회가 정상이다(INV-U5-05)" {
        val f = fixture()

        f.svc.putMemo(acc, tripId, f.visitCheckId, "사진 없이 남기는 감상")

        f.svc.listPhotos(acc, tripId, f.visitCheckId) shouldBe emptyList()
        f.svc.findMemo(acc, tripId, f.visitCheckId)!!.text shouldBe "사진 없이 남기는 감상"
    }

    "여행 안 방문별 사진 개수를 센다 — AI 컨텍스트가 쓰는 것은 이것뿐이다" {
        val f = fixture()
        f.svc.addPhoto(acc, tripId, f.visitCheckId, photo("a"))
        f.svc.addPhoto(acc, tripId, f.visitCheckId, photo("b"))

        f.svc.photoCountsByVisit(acc, tripId) shouldBe mapOf(f.visitCheckId to 2)
    }
    /**
     * 위치를 **실제로 보관했을 때만** 수집 사실을 남긴다(TRIP-857). 표는 "위치를 모으면 사실을
     * 남긴다"는 전제로 만들어져 있는데(V1.3 `COLLECTION`), 정작 좌표를 보관하는 이 경로가
     * 로그를 한 번도 부르지 않고 있었다.
     */
    "동의가 있고 EXIF 가 실리면 수집 사실이 남는다" {
        val f = fixture(gpsOptIn = true)

        val saved = f.svc.addPhoto(acc, tripId, f.visitCheckId, photo())

        f.legalLogs.collected.single() shouldBe Triple(acc, LocationCollectionSource.PHOTO_EXIF, saved.visitPhotoMetaId)
    }

    /** 동의가 없으면 좌표를 버리므로 **수집이 아니다** — 확인자료가 모은 적 없는 위치를 말하면 안 된다. */
    "동의가 없으면 좌표도 로그도 남지 않는다" {
        val f = fixture(gpsOptIn = false)

        val saved = f.svc.addPhoto(acc, tripId, f.visitCheckId, photo())

        saved.exifLat.shouldBeNull()
        f.legalLogs.collected.shouldBeEmpty()
    }

    /** 동의가 있어도 사진에 EXIF 가 없으면 모을 것이 없다 — 요청이 아니라 **저장 결과**로 판정한다. */
    "EXIF 가 없는 사진은 동의가 있어도 로그를 남기지 않는다" {
        val f = fixture(gpsOptIn = true)

        f.svc.addPhoto(acc, tripId, f.visitCheckId, photo(lat = null, lng = null))

        f.legalLogs.collected.shouldBeEmpty()
    }
    /**
     * 철회하면 **이미 저장된 좌표도 지운다**(INV-L4). 게이팅은 앞으로 들어올 것만 막아서,
     * 이게 없으면 "철회했는데 예전 좌표는 남아 있는" 상태가 된다 — 게이팅이 잘 도는 탓에 더 안 드러난다.
     */
    "파기하면 좌표만 사라지고 사진 카드는 남는다" {
        val f = fixture(gpsOptIn = true)
        val saved = f.svc.addPhoto(acc, tripId, f.visitCheckId, photo())

        val purged = f.svc.purgeExifCoordinates(acc)

        purged shouldBe 1
        val after = f.photos.findById(saved.visitPhotoMetaId)!!
        after.exifLat.shouldBeNull()
        after.exifLng.shouldBeNull()
        // 사진 자체는 사용자 기기에 있고 우리는 메타만 든다 — 좌표를 지워도 잃는 것이 없어야 한다.
        after.localAssetId shouldBe saved.localAssetId
        f.legalLogs.purged.single() shouldBe Triple(acc, LocationPurgeScope.PHOTO_EXIF, 1)
    }

    /** 지울 것이 없으면 **기록하지 않는다** — 재배달마다 0건 기록이 쌓이면 확인자료가 의미를 잃는다. */
    "지울 좌표가 없으면 파기 기록도 남지 않는다" {
        val f = fixture(gpsOptIn = false)
        f.svc.addPhoto(acc, tripId, f.visitCheckId, photo()) // 동의가 없어 좌표가 애초에 안 들어간다

        f.svc.purgeExifCoordinates(acc) shouldBe 0

        f.legalLogs.purged.shouldBeEmpty()
    }

    /** 멱등 — at-least-once 배달이라 같은 철회가 두 번 와도 건수가 부풀면 안 된다. */
    "두 번 파기해도 두 번째는 지울 것이 없다" {
        val f = fixture(gpsOptIn = true)
        f.svc.addPhoto(acc, tripId, f.visitCheckId, photo())

        f.svc.purgeExifCoordinates(acc) shouldBe 1
        f.svc.purgeExifCoordinates(acc) shouldBe 0

        f.legalLogs.purged.size shouldBe 1
    }
})
