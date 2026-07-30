package com.trippilot.placedata.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.placedata.InMemoryPoiRepository
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSource
import com.trippilot.placedata.domain.SavedPlace
import com.trippilot.placedata.domain.SavedPlaceRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

private class FakeSavedPlaces : SavedPlaceRepository {
    val stored = mutableListOf<SavedPlace>()
    override fun save(savedPlace: SavedPlace) = savedPlace.also { stored.add(it) }
    override fun findByAccount(accountId: UUID) = stored.filter { it.accountId == accountId }
    override fun findById(savedPlaceId: UUID) = stored.firstOrNull { it.savedPlaceId == savedPlaceId }
    override fun existsByAccountAndPoi(accountId: UUID, poiId: UUID) = stored.any { it.accountId == accountId && it.poiId == poiId }
    override fun delete(savedPlace: SavedPlace) { stored.removeIf { it.savedPlaceId == savedPlace.savedPlaceId } }
}

class SavedPlaceServiceTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-07-31T00:00:00Z"), ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val other = UUID.randomUUID()

    fun fixture(status: DataStatus = DataStatus.ACTIVE): Triple<SavedPlaceService, FakeSavedPlaces, UUID> {
        val pois = InMemoryPoiRepository()
        val poi = Poi.reconstitute(UUID.randomUUID(), "성산일출봉", 33.45, 126.94, PoiCategory.자연, "제주", null, status, PoiSource.MANUAL, 0, clock.instant(), clock.instant())
        pois.stored.add(poi)
        val saved = FakeSavedPlaces()
        return Triple(SavedPlaceService(saved, pois, clock), saved, poi.poiId)
    }

    "담기 후 목록에 POI 정보와 함께" {
        val (svc, _, poiId) = fixture()
        svc.save(acc, poiId).poi.nameKo shouldBe "성산일출봉"
        svc.list(acc).single().poi.poiId shouldBe poiId
    }

    "없거나 비-ACTIVE POI 담기는 404" {
        val (svc, _, _) = fixture(status = DataStatus.UNVERIFIED)
        shouldThrow<ResourceNotFound> { svc.save(acc, UUID.randomUUID()) } // 없음
        val (svc2, _, poiId) = fixture(status = DataStatus.UNVERIFIED)
        shouldThrow<ResourceNotFound> { svc2.save(acc, poiId) } // 비-ACTIVE
    }

    "이미 담은 POI 재담기는 409" {
        val (svc, _, poiId) = fixture()
        svc.save(acc, poiId)
        shouldThrow<ConflictDetected> { svc.save(acc, poiId) }
    }

    "타 계정 해제는 404" {
        val (svc, _, poiId) = fixture()
        val sp = svc.save(acc, poiId)
        shouldThrow<ResourceNotFound> { svc.remove(other, sp.savedPlace.savedPlaceId) }
    }
})
