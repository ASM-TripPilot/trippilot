package com.trippilot.trip.application

import com.trippilot.core.export.AccountDataContributor
import com.trippilot.core.export.ExportSection
import com.trippilot.trip.domain.TripRepository
import org.springframework.stereotype.Component
import java.util.UUID

/** 여행 몫(TRIP-551). 소프트 삭제된 여행도 **낸다** — 사용자 것이었고, 아직 파기되지 않았다. */
@Component
class TripExportContributor(private val trips: TripRepository) : AccountDataContributor {
    override val section = "trips"

    override fun export(accountId: UUID, limit: Int): ExportSection = ExportSection.of(
        section,
        trips.findByAccount(accountId).sortedByDescending { it.startDate }.map {
            mapOf(
                "tripId" to it.tripId.toString(),
                "title" to it.title,
                "startDate" to it.startDate.toString(),
                "endDate" to it.endDate.toString(),
                "party" to it.party,
                "destinations" to it.destinations.sortedBy { d -> d.seq }.map { d -> mapOf("region" to d.region, "nights" to d.nights) },
                "status" to it.status.name,
                "deletedAt" to it.deletedAt?.toString(),
                "createdAt" to it.createdAt.toString(),
            )
        },
        limit,
    )
}
