package com.trippilot.archive.application

import com.trippilot.archive.domain.VisitCheck
import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.archive.domain.VisitMemoRepository
import com.trippilot.archive.domain.VisitPhotoMetaRepository
import com.trippilot.changelog.api.ChangeLogEntryView
import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.savedaccommodation.api.TripBaseStayFacade
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * 계획｜실제｜변경 3종 비교(`j02` · US-REC-05).
 *
 * **아무것도 저장하지 않는다.** 미방문도 숙소 귀속도 조회 시점에 갈라낸다 —
 * - **미방문**(BR-U5-28) = "계획엔 있는데 실적이 없는 슬롯". 플래그로 저장하면 계획이 바뀔 때 어긋난다
 * - **숙소 귀속**(BR-U5-25·26) = 그 날의 기준 숙소. 저장하면 숙소를 바꿔도 옛 기록이 따라오지 않는다
 *
 * 계획은 덮이지 않는다(BR-U5-01) — 계획과 실제가 달라도 그 자체가 사실이라, 둘을 나란히 두는 것이
 * 이 화면의 전부다.
 */
@Service
class TripRecordService(
    private val trips: TripFacade,
    private val plans: ItineraryPlanFacade,
    private val checks: VisitCheckRepository,
    private val photos: VisitPhotoMetaRepository,
    private val memos: VisitMemoRepository,
    private val baseStays: TripBaseStayFacade,
    private val changeLog: ChangeLogFacade,
) {
    @Transactional(readOnly = true)
    fun compare(accountId: UUID, tripId: UUID, changeLimit: Int = DEFAULT_CHANGE_LIMIT): TripRecord {
        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)

        val planned = plans.findPlanSlots(accountId, tripId)
        val actual = checks.findByTrip(tripId)
        val visitIds = actual.map { it.visitCheckId }
        val photoCounts = photos.countByVisits(visitIds)
        val withMemo = memos.findVisitsWithMemo(visitIds)
        // 그날 어디에 묵었나 — 없는 날은 목록에 없다. 그 날은 날짜만으로 묶인다(BR-U5-27).
        val baseByDate = baseStays.findBaseStays(tripId, period.startDate, period.endDate).associateBy { it.date }

        val actualBySlot = actual.mapNotNull { v -> v.slotKey?.let { it to v } }.toMap()
        // 계획에 있는데 실적이 없다 — **판정일 뿐 저장하지 않는다**(BR-U5-28).
        val unvisited = planned.filter { it.slotKey !in actualBySlot }

        val days = (planned.map { it.date } + actual.map { it.dayOf() })
            .distinct()
            .sorted()
            .map { date ->
                TripRecordDay(
                    date = date,
                    baseStayId = baseByDate[date]?.savedStayId,
                    baseStayName = baseByDate[date]?.name,
                    planned = planned.filter { it.date == date }.sortedBy { it.orderIndex },
                    actual = actual.filter { it.dayOf() == date }.sortedBy { it.arrivedAt ?: it.createdAt }
                        .map { it.toRecord(photoCounts[it.visitCheckId] ?: 0, it.visitCheckId in withMemo) },
                    unvisitedSlotKeys = unvisited.filter { it.date == date }.map { it.slotKey },
                )
            }

        return TripRecord(
            tripId = tripId,
            days = days,
            // 변경 이력은 **읽기만** 한다(BR-U5-29). 소유 판정·상한·최신순은 소유 모듈이 이미 했다.
            changes = changeLog.findTimeline(accountId, tripId, changeLimit),
        )
    }

    /**
     * 하루 묶기는 **여행지 기준 날짜**다(U4 승계). 즉석 방문은 슬롯 키가 없어 날짜로 못 거르므로
     * 도착 시각으로 묶는다 — 도착이 없으면 생성 시각으로 본다.
     */
    private fun VisitCheck.dayOf(): LocalDate = LocalDate.ofInstant(arrivedAt ?: createdAt, TRAVEL_ZONE)

    /**
     * **체류 시간을 싣지 않는다**(BR-U5-08). 산출은 되지만 개별 방문의 체류로 화면에 보이지 않는다 —
     * 누적 평균(US-REC-09)은 별개 소관이다(BR-U5-08a).
     */
    private fun VisitCheck.toRecord(photoCount: Int, hasMemo: Boolean) = ActualVisitRecord(
        visitCheckId = visitCheckId,
        slotKey = slotKey,
        poiId = poiId,
        arrivedAt = arrivedAt,
        completedAt = completedAt,
        skippedAt = skippedAt,
        spontaneous = isSpontaneous,
        photoCount = photoCount,
        hasMemo = hasMemo,
        updatedAt = updatedAt,
    )

    companion object {
        /** 변경 이력 기본 건수. 화면이 탭 하나에 그리는 분량이고, 더 필요하면 그쪽 표면이 커서를 낸다. */
        const val DEFAULT_CHANGE_LIMIT = 100

        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}

/** 3종 비교 한 벌. 탭이 리스트 필터든 지도 레이어든 같은 자료를 쓴다(O-U5-3 미결과 무관하게 성립). */
data class TripRecord(
    val tripId: UUID,
    val days: List<TripRecordDay>,
    val changes: List<ChangeLogEntryView>,
)

/**
 * 하루치.
 *
 * @property baseStayName 그날의 기준 숙소. **파생값이라 저장돼 있지 않다** — 숙소를 바꾸면 같은 기록의
 *   귀속이 따라 바뀐다. 등록 숙소가 없거나 겹침이 미해결이면 null 이고, 그 날은 날짜만으로 묶인다.
 * @property unvisitedSlotKeys 계획엔 있는데 실적이 없는 슬롯(BR-U5-28). 저장되지 않는 판정이다.
 */
data class TripRecordDay(
    val date: LocalDate,
    val baseStayId: UUID?,
    val baseStayName: String?,
    val planned: List<PlannedSlotView>,
    val actual: List<ActualVisitRecord>,
    val unvisitedSlotKeys: List<String>,
)

/** 실적 한 건. 사진·메모는 **있는지/몇 장인지**까지만 — 본문은 각자의 표면이 낸다. */
data class ActualVisitRecord(
    val visitCheckId: UUID,
    val slotKey: String?,
    val poiId: UUID,
    val arrivedAt: java.time.Instant?,
    val completedAt: java.time.Instant?,
    val skippedAt: java.time.Instant?,
    val spontaneous: Boolean,
    val photoCount: Int,
    val hasMemo: Boolean,
    val updatedAt: java.time.Instant,
)
