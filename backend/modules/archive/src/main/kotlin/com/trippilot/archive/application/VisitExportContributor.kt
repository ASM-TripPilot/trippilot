package com.trippilot.archive.application

import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.archive.domain.VisitMemoRepository
import com.trippilot.archive.domain.VisitPhotoMetaRepository
import com.trippilot.core.export.AccountDataContributor
import com.trippilot.core.export.ExportSection
import com.trippilot.trip.api.TripListFacade
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 방문 기록 몫(TRIP-551) — 실적·메모·사진 **메타**.
 *
 * **사진 바이너리는 없다**(INV-U5-03). 서버가 갖고 있지 않으므로 내보낼 것도 메타뿐이다 —
 * 기기 자산 식별자와 촬영 시각. 받는 사람이 이걸로 자기 기기의 사진을 찾을 수 있다.
 */
@Component
class VisitExportContributor(
    private val trips: TripListFacade,
    private val checks: VisitCheckRepository,
    private val photos: VisitPhotoMetaRepository,
    private val memos: VisitMemoRepository,
) : AccountDataContributor {
    override val section = "visits"

    override fun export(accountId: UUID, limit: Int): ExportSection {
        // 여행 목록을 통해서만 계정 경계를 넘는다 — 실적은 여행에 매달려 있고, 여행이 계정을 안다.
        val tripIds = trips.findTripsOf(accountId, TRIP_SCAN_LIMIT).map { it.tripId }
        val rows = tripIds.flatMap { tripId ->
            val visits = checks.findByTrip(tripId)
            val withMemo = memos.findVisitsWithMemo(visits.map { it.visitCheckId })
            visits.map { v ->
                mapOf(
                    "tripId" to tripId.toString(),
                    "visitCheckId" to v.visitCheckId.toString(),
                    "slotKey" to v.slotKey,
                    "poiId" to v.poiId.toString(),
                    "arrivedAt" to v.arrivedAt?.toString(),
                    "completedAt" to v.completedAt?.toString(),
                    "skippedAt" to v.skippedAt?.toString(),
                    "memo" to if (v.visitCheckId in withMemo) memos.find(v.visitCheckId)?.text else null,
                    // 바이너리가 아니라 **어느 기기의 어느 자산이었나**다(INV-U5-03).
                    "photos" to photos.findByVisit(v.visitCheckId).map { p ->
                        mapOf(
                            "localAssetId" to p.localAssetId,
                            "deviceId" to p.deviceId,
                            "takenAt" to p.takenAt?.toString(),
                            "exifLat" to p.exifLat,
                            "exifLng" to p.exifLng,
                        )
                    },
                )
            }
        }
        return ExportSection.of(section, rows, limit)
    }

    private companion object {
        /** 훑을 여행 수. 여행 자체는 `trips` 몫이 따로 내므로 여기서는 실적을 모으는 범위일 뿐이다. */
        private const val TRIP_SCAN_LIMIT = 200
    }
}
