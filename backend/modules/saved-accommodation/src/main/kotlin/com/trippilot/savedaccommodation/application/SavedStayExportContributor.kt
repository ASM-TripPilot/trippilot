package com.trippilot.savedaccommodation.application

import com.trippilot.core.export.AccountDataContributor
import com.trippilot.core.export.ExportSection
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import org.springframework.stereotype.Component
import java.util.UUID

/** 저장한 숙소 몫(TRIP-551). */
@Component
class SavedStayExportContributor(private val stays: SavedStayRepository) : AccountDataContributor {
    override val section = "savedStays"

    override fun export(accountId: UUID, limit: Int): ExportSection = ExportSection.of(
        section,
        stays.findByAccount(accountId).sortedByDescending { it.createdAt }.map {
            mapOf(
                "savedStayId" to it.savedStayId.toString(),
                "name" to it.name,
                "checkIn" to it.checkIn?.toString(),
                "checkOut" to it.checkOut?.toString(),
                "lat" to it.lat,
                "lng" to it.lng,
                "memo" to it.memo,
                "createdAt" to it.createdAt.toString(),
            )
        },
        limit,
    )
}
