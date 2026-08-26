package com.trippilot.archive.application

import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.VisitCheck
import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.archive.domain.VisitMemo
import com.trippilot.archive.domain.VisitMemoRepository
import com.trippilot.archive.domain.VisitPhotoMeta
import com.trippilot.archive.domain.VisitPhotoMetaRepository
import com.trippilot.auth.api.LocationConsentFacade
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
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

    class Fixture(val svc: VisitRecordService, val photos: Photos, val memos: Memos, val visitCheckId: UUID)

    fun fixture(gpsOptIn: Boolean = true): Fixture {
        val checks = Checks()
        val photos = Photos()
        val memos = Memos()
        val visit = checks.save(VisitCheck.arrive(tripId, "2026-08-11#$poi", poi, CheckSource.MANUAL, now))
        return Fixture(VisitRecordService(trips, checks, photos, memos, consents(gpsOptIn), clock), photos, memos, visit.visitCheckId)
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
})
