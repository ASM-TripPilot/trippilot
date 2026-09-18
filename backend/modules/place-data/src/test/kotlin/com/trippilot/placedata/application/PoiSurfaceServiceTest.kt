package com.trippilot.placedata.application

import com.trippilot.placedata.InMemoryPoiRepository
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSnapshot
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.placedata.domain.PoiSnapshotRepository
import com.trippilot.placedata.domain.PoiSource
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactlyInAnyOrder
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.util.UUID

/**
 * 표시용 POI 표면(BR-U3-09 · DEC-U3-9). 일정 슬롯은 `poiId` 만 들고 있어 화면이 장소명·좌표를 그리려면
 * 이 합성이 필요하다 — **일정·재계획 화면이 전부 이것에 걸려 있다.**
 *
 * 가장 중요한 규칙: **상태 무관으로 돌려준다.** 후보풀(INV-U1-01 ACTIVE만)과 반대다 —
 * 여기는 *이미 일정에 들어간* 장소의 표시라, 생성 후 폐업·미확인으로 바뀌었다고 화면에서 사라지면
 * 사용자는 자기 일정에서 장소가 증발하는 것을 본다. 그 규칙을 여기서 못 박는다.
 */
class PoiSurfaceServiceTest : StringSpec({

    val now = Instant.parse("2026-08-11T00:00:00Z")

    fun poi(name: String, status: DataStatus = DataStatus.ACTIVE, image: String? = null, hours: String? = null): Poi =
        Poi.reconstitute(
            UUID.randomUUID(), name, 33.45, 126.56, PoiCategory.맛집, "제주", hours, status, PoiSource.MANUAL,
            0, now, now, image,
        )

    /** 스냅숏은 확정 시 동결분 — 원본이 사라져도 유지된다(INV-U1-03). */
    class Snapshots(private val stored: List<PoiSnapshot> = emptyList()) : PoiSnapshotRepository {
        override fun save(snapshot: PoiSnapshot) = snapshot
        override fun findById(poiSnapshotId: UUID) = stored.firstOrNull { it.poiSnapshotId == poiSnapshotId }
        override fun findByIds(poiSnapshotIds: Collection<UUID>) =
            stored.filter { it.poiSnapshotId in poiSnapshotIds }
    }

    fun service(repo: PoiRepository, snapshots: Snapshots = Snapshots()) = PoiSurfaceService(repo, snapshots)

    /** 호출을 관측하는 위임 저장소 — InMemoryPoiRepository 는 final 이라 상속 대신 감싼다. */
    class SpyingPoiRepository(private val delegate: PoiRepository) : PoiRepository by delegate {
        var calls = 0
        var lastArg: List<UUID> = emptyList()
        override fun findByIds(poiIds: List<UUID>): List<Poi> {
            calls++
            lastArg = poiIds
            return delegate.findByIds(poiIds)
        }
    }

    "폐업·미확인 장소도 표면이 나온다 — 이미 일정에 들어간 장소가 화면에서 사라지면 안 된다" {
        val repo = InMemoryPoiRepository()
        val active = poi("자갈치시장")
        val closed = poi("폐업한집", status = DataStatus.CLOSED)
        val unverified = poi("미확인집", status = DataStatus.UNVERIFIED)
        val lost = poi("좌표없음", status = DataStatus.LOST)
        repo.saveAll(listOf(active, closed, unverified, lost))

        val surfaces = service(repo).findSurfaces(listOf(active.poiId, closed.poiId, unverified.poiId, lost.poiId))

        // 후보풀이었다면 ACTIVE 하나만 남았을 것이다 — 여기서는 넷 다 나와야 한다
        surfaces.keys shouldContainExactlyInAnyOrder listOf(active.poiId, closed.poiId, unverified.poiId, lost.poiId)
        surfaces.getValue(closed.poiId).nameKo shouldBe "폐업한집"
    }

    "없는 id 는 키가 빠진다 — 지어내지 않는다" {
        val repo = InMemoryPoiRepository()
        val a = poi("자갈치시장")
        repo.saveAll(listOf(a))

        val surfaces = service(repo).findSurfaces(listOf(a.poiId, UUID.randomUUID()))
        surfaces.size shouldBe 1
        surfaces.containsKey(a.poiId) shouldBe true
    }

    "빈 목록이면 조회하지 않는다 · 중복은 한 번만 조회한다 — 슬롯마다 왕복하지 않게" {
        val delegate = InMemoryPoiRepository()
        val a = poi("자갈치시장")
        delegate.saveAll(listOf(a))
        val spy = SpyingPoiRepository(delegate)

        PoiSurfaceService(spy, Snapshots()).findSurfaces(emptyList()) shouldBe emptyMap()
        spy.calls shouldBe 0 // 빈 입력에 헛 왕복이 없다

        PoiSurfaceService(spy, Snapshots()).findSurfaces(listOf(a.poiId, a.poiId, a.poiId))
        spy.calls shouldBe 1
        spy.lastArg shouldBe listOf(a.poiId) // 중복 제거
    }

    "미확보 값은 null 그대로 — 기본 이미지를 지어내지 않는다(TRIP-219)" {
        val repo = InMemoryPoiRepository()
        val bare = poi("사진없음")
        repo.saveAll(listOf(bare))

        val view = service(repo).findSurfaces(listOf(bare.poiId)).getValue(bare.poiId)
        view.imageUrl shouldBe null
        view.openingHours shouldBe null // NULL = 미확인(허용) — 빈 문자열로 채우면 "확인됨"으로 읽힌다
    }

    "동결 표면은 스냅숏에서 온다 — 원본이 바뀌어도 확정 일정은 흔들리지 않는다(INV-U1-03)" {
        val snapshotId = UUID.randomUUID()
        val sourceId = UUID.randomUUID()
        val frozen = PoiSnapshot.reconstitute(snapshotId, sourceId, "동결된이름", 33.1, 126.1, PoiCategory.맛집, now)
        val repo = InMemoryPoiRepository()

        val views = service(repo, Snapshots(listOf(frozen))).findFrozenSurfaces(listOf(snapshotId))
        views.getValue(snapshotId).nameKo shouldBe "동결된이름"
        views.getValue(snapshotId).sourcePoiId shouldBe sourceId
    }

    "동결 표면도 빈 목록이면 조회하지 않는다" {
        service(InMemoryPoiRepository()).findFrozenSurfaces(emptyList()) shouldBe emptyMap()
    }
})
