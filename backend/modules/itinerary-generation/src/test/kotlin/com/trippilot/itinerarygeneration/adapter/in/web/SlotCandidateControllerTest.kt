package com.trippilot.itinerarygeneration.adapter.`in`.web

import com.trippilot.itinerarygeneration.application.RequestSlotCandidates
import com.trippilot.itinerarygeneration.application.SlotCandidateService
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.SlotCandidate
import com.trippilot.itinerarygeneration.domain.SlotCandidatesOutput
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.mockk.every
import io.mockk.mockk
import java.security.Principal
import java.time.Instant
import java.util.UUID

/**
 * 표면 조회는 **후보 전부를 한 번에**(TRIP-1005 AC — N+1 금지). 후보마다 조회로 바뀌면
 * 컴파일도 응답 모양도 그대로라 이 잠금 없이는 조용히 왕복이 후보 수만큼 늘어난다.
 */
class SlotCandidateControllerTest : StringSpec({

    val ids = List(3) { UUID.randomUUID() }
    val output = SlotCandidatesOutput(
        candidates = ids.map { SlotCandidate(it, "약 0.5km", "주변 카페") },
        radiusMUsed = 3_000,
        freshness = FreshnessMeta(Instant.parse("2026-09-28T00:00:00Z"), degraded = false),
        emptyReason = null,
    )
    val principal = Principal { UUID.randomUUID().toString() }

    "표면 조회는 후보 N건에 대해 1회다 — 카드마다 왕복하지 않는다" {
        val service = mockk<SlotCandidateService> {
            every { propose(any(), any(), any<RequestSlotCandidates>()) } returns output
        }
        val calls = mutableListOf<Collection<UUID>>()
        val surfaces = object : PoiSurfaceFacade {
            override fun findSurfaces(poiIds: Collection<UUID>): Map<UUID, PoiSurfaceView> {
                calls += poiIds
                return emptyMap()
            }
            override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
        }

        SlotCandidateController(service, surfaces)
            .propose(principal, UUID.randomUUID(), SlotCandidatesRequest("2026-08-01#${ids[0]}", null, null, null))

        calls.size shouldBe 1
        calls.single().toSet() shouldBe ids.toSet() // 전부를 한 번에
    }

    "후보 0건이면 표면 조회를 하지 않는다" {
        val service = mockk<SlotCandidateService> {
            every { propose(any(), any(), any<RequestSlotCandidates>()) } returns output.copy(candidates = emptyList())
        }
        var called = 0
        val surfaces = object : PoiSurfaceFacade {
            override fun findSurfaces(poiIds: Collection<UUID>): Map<UUID, PoiSurfaceView> {
                called++
                return emptyMap()
            }
            override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
        }

        SlotCandidateController(service, surfaces)
            .propose(principal, UUID.randomUUID(), SlotCandidatesRequest("2026-08-01#${ids[0]}", null, null, null))

        called shouldBe 0
    }
})
