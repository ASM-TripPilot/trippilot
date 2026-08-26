package com.trippilot.archive.application

import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.archive.domain.VisitMemo
import com.trippilot.archive.domain.VisitMemoRepository
import com.trippilot.archive.domain.VisitPhotoMeta
import com.trippilot.archive.domain.VisitPhotoMetaRepository
import com.trippilot.auth.api.LocationConsentFacade
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant
import java.util.UUID

/**
 * 방문에 붙는 기록 — 사진 **메타**와 메모(BR-U5-11·13).
 *
 * **업로드 API 가 아니다.** 서버는 바이너리를 받지도 두지도 않는다(INV-U5-03) — 여기서 다루는 것은
 * "어느 기기의 어느 자산이 어느 방문에 붙었나"까지다.
 *
 * 사진과 메모는 서로를 막지 않는다(INV-U5-05) — 자산을 못 열어도 메모는 남고, 사진이 0장이어도
 * 메모·방문 체크는 정상이다. 화면이 "사진을 불러올 수 없어요"를 그리는 동안 데이터는 온전하다.
 */
@Service
class VisitRecordService(
    private val trips: TripFacade,
    private val checks: VisitCheckRepository,
    private val photos: VisitPhotoMetaRepository,
    private val memos: VisitMemoRepository,
    private val locationConsents: LocationConsentFacade,
    private val clock: Clock,
) {
    /**
     * 사진 메타 등록.
     *
     * 좌표 수용 여부는 **요청 시점의 동의 상태**로 판정한다(INV-U5-04). 값을 복사해 두지 않는 이유는
     * 철회가 반영되지 않아서다 — 동의를 거둔 뒤에도 좌표가 계속 들어오면 그것이 곧 위반이다.
     */
    @Transactional
    fun addPhoto(
        accountId: UUID,
        tripId: UUID,
        visitCheckId: UUID,
        command: AddVisitPhoto,
    ): VisitPhotoMeta {
        ownedVisit(accountId, tripId, visitCheckId)
        if (photos.findByVisit(visitCheckId).size >= MAX_PHOTOS_PER_VISIT) {
            throw ValidationFailed(listOf(FieldError("photos", "한 방문에 사진은 최대 ${MAX_PHOTOS_PER_VISIT}장까지 붙일 수 있습니다")))
        }
        return photos.save(
            VisitPhotoMeta.attach(
                visitCheckId = visitCheckId,
                localAssetId = command.localAssetId,
                deviceId = command.deviceId,
                takenAt = command.takenAt,
                exifLat = command.exifLat,
                exifLng = command.exifLng,
                sortOrder = command.sortOrder ?: nextSortOrder(visitCheckId),
                gpsRecordingOptIn = locationConsents.hasGpsRecordingOptIn(accountId),
            ),
        )
    }

    @Transactional(readOnly = true)
    fun listPhotos(accountId: UUID, tripId: UUID, visitCheckId: UUID): List<VisitPhotoMeta> {
        ownedVisit(accountId, tripId, visitCheckId)
        return photos.findByVisit(visitCheckId)
    }

    @Transactional
    fun removePhoto(accountId: UUID, tripId: UUID, visitCheckId: UUID, visitPhotoMetaId: UUID) {
        ownedVisit(accountId, tripId, visitCheckId)
        // 그 방문의 사진인지까지 본다 — id 만으로 지우면 남의 방문 사진을 지울 수 있다.
        val photo = photos.findById(visitPhotoMetaId)?.takeIf { it.visitCheckId == visitCheckId }
            ?: throw ResourceNotFound("사진을 찾을 수 없습니다.")
        photos.delete(photo.visitPhotoMetaId)
    }

    /**
     * 정렬 변경 — 주어진 순서대로 다시 매긴다.
     *
     * **빠진 사진이 있으면 거부한다.** 부분 목록을 받아 그것만 다시 매기면 나머지와 순서가 겹쳐
     * "어느 것이 먼저인가"가 사라진다. 매칭이 0건인데 성공을 보고하는 경로도 여기서 막힌다.
     */
    @Transactional
    fun reorderPhotos(accountId: UUID, tripId: UUID, visitCheckId: UUID, orderedIds: List<UUID>) {
        ownedVisit(accountId, tripId, visitCheckId)
        val current = photos.findByVisit(visitCheckId)
        if (orderedIds.toSet() != current.map { it.visitPhotoMetaId }.toSet() || orderedIds.size != current.size) {
            throw ValidationFailed(listOf(FieldError("orderedIds", "그 방문의 사진 전부를 한 번씩 담아야 합니다")))
        }
        val byId = current.associateBy { it.visitPhotoMetaId }
        orderedIds.forEachIndexed { index, id -> photos.save(byId.getValue(id).copy(sortOrder = index)) }
    }

    /** 메모 저장(upsert). 한 방문에 한 개라 "만들기"와 "고치기"를 나누지 않는다(BR-U5-13). */
    @Transactional
    fun putMemo(accountId: UUID, tripId: UUID, visitCheckId: UUID, text: String): VisitMemo {
        ownedVisit(accountId, tripId, visitCheckId)
        return memos.upsert(VisitMemo(visitCheckId, text.trim(), clock.instant()))
    }

    @Transactional(readOnly = true)
    fun findMemo(accountId: UUID, tripId: UUID, visitCheckId: UUID): VisitMemo? {
        ownedVisit(accountId, tripId, visitCheckId)
        return memos.find(visitCheckId)
    }

    @Transactional
    fun removeMemo(accountId: UUID, tripId: UUID, visitCheckId: UUID) {
        ownedVisit(accountId, tripId, visitCheckId)
        // 없는 것을 지워도 오류가 아니다 — 삭제는 멱등이 자연스럽다.
        memos.delete(visitCheckId)
    }

    /**
     * 여행 안 방문별 사진 **개수**. AI 컨텍스트 조립이 필요로 하는 것이 정확히 이것이다 —
     * 사진 자체가 아니라 "몇 장 찍었나"(TRIP-478 회신).
     */
    @Transactional(readOnly = true)
    fun photoCountsByVisit(accountId: UUID, tripId: UUID): Map<UUID, Int> {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        return photos.countByVisits(checks.findByTrip(tripId).map { it.visitCheckId })
    }

    /** 새 사진은 맨 뒤에 붙는다. 비어 있으면 0. */
    private fun nextSortOrder(visitCheckId: UUID): Int =
        photos.findByVisit(visitCheckId).maxOfOrNull { it.sortOrder }?.plus(1) ?: 0

    private fun ownedVisit(accountId: UUID, tripId: UUID, visitCheckId: UUID) {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        checks.findById(visitCheckId)?.takeIf { it.tripId == tripId }
            ?: throw ResourceNotFound("방문 기록을 찾을 수 없습니다.")
    }

    companion object {
        /**
         * 한 방문의 사진 상한. 메타만 쌓여도 목록·정렬이 한 화면을 넘어서면 쓸모가 없고,
         * 상한 없는 등록 경로는 그 자체로 남용 통로다.
         */
        const val MAX_PHOTOS_PER_VISIT = 30
    }
}

/** 사진 메타 등록 입력. [sortOrder] 를 주지 않으면 맨 뒤에 붙는다. */
data class AddVisitPhoto(
    val localAssetId: String,
    val deviceId: String,
    val takenAt: Instant?,
    val exifLat: Double?,
    val exifLng: Double?,
    val sortOrder: Int?,
)
