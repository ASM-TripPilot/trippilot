package com.trippilot.archive.application

import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.archive.domain.VisitPhotoMetaRepository
import com.trippilot.trip.api.TripListFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.LocalDate
import java.util.UUID

/**
 * 지난 여행 기록 목록(`j07` · BR-U5-56).
 *
 * 재열람은 **여행 단위**로 들어간다 — 목록에서 여행을 고르고, 거기서 계획·실제·변경 3종으로 갈린다
 * (그 표면은 TRIP-544).
 *
 * **빈 상태를 값으로 알린다.** 조용히 빈 배열만 주면 화면이 "오류인가, 상한에 걸렸나, 정말 없나"를
 * 구분하지 못한다 — 그 셋은 사용자에게 보여 줄 것이 전부 다르다(INV-4 결).
 */
@Service
class TripRecordListService(
    private val trips: TripListFacade,
    private val checks: VisitCheckRepository,
    private val photos: VisitPhotoMetaRepository,
) {
    @Transactional(readOnly = true)
    fun list(accountId: UUID, limit: Int = DEFAULT_LIMIT): TripRecordList {
        val summaries = trips.findTripsOf(accountId, limit.coerceIn(1, MAX_LIMIT))
        val items = summaries.map { trip ->
            val visits = checks.findByTrip(trip.tripId)
            TripRecordSummary(
                tripId = trip.tripId,
                title = trip.title,
                startDate = trip.startDate,
                endDate = trip.endDate,
                regions = trip.regions,
                // 목록에서 바로 보이는 한 줄 — 상세는 3종 비교로 넘긴다.
                visitCount = visits.size,
                photoCount = photos.countByVisits(visits.map { it.visitCheckId }).values.sum(),
            )
        }
        return TripRecordList(
            items = items,
            // 비어 있을 때만 이유를 붙인다 — 있는데도 붙이면 화면이 둘을 다 보고 갈피를 잃는다.
            emptyState = if (items.isNotEmpty()) null else emptyStateOf(accountId),
        )
    }

    /**
     * 왜 비었나. 여행 자체가 없으면 [RecordEmptyState.NO_TRIPS] — 화면은 빈 화면 대신
     * "아직 기록된 여행이 없습니다" + 새 여행 생성 진입을 그린다(`j07` 빈 상태).
     */
    private fun emptyStateOf(accountId: UUID): RecordEmptyState =
        if (trips.hasAnyTrip(accountId)) RecordEmptyState.NO_RECORDS else RecordEmptyState.NO_TRIPS

    companion object {
        const val DEFAULT_LIMIT = 30

        /** 전량 반환은 없다 — 여행은 계정 수명 내내 쌓인다(`/places` 선례). */
        const val MAX_LIMIT = 100
    }
}

/** 목록 한 벌. [emptyState] 는 [items] 가 비었을 때만 채워진다. */
data class TripRecordList(
    val items: List<TripRecordSummary>,
    val emptyState: RecordEmptyState?,
)

/**
 * 빈 이유. 화면이 보여 줄 것이 갈린다 — 여행이 없으면 만들라고 하고, 여행은 있는데 기록이 없으면
 * 기다리라고 한다. 둘을 한 가지로 뭉치면 사용자가 무엇을 해야 할지 모른다.
 */
enum class RecordEmptyState { NO_TRIPS, NO_RECORDS }

/** 여행 한 줄. 상세는 3종 비교(TRIP-544)로 넘긴다. */
data class TripRecordSummary(
    val tripId: UUID,
    val title: String,
    val startDate: LocalDate,
    val endDate: LocalDate,
    val regions: List<String>,
    val visitCount: Int,
    val photoCount: Int,
)
