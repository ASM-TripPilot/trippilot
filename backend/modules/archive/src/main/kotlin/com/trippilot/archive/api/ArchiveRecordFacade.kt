package com.trippilot.archive.api

import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 날짜별 방문 실적 조회(C12) — 공개 계약(R1, `..api..`).
 *
 * [ArchiveFacade] 와 따로 두는 이유는 **묻는 것이 다르기** 때문이다. 그쪽은 재계획이 "무엇을 잠글까"를
 * 묻고 완료분만 보면 된다. 여기는 회고(U5)가 "그날 무엇을 했나"를 묻고, 건너뛴 것도 사진·메모 유무도
 * 사실의 일부다.
 *
 * 실무적 이유도 같다 — [ArchiveFacade] 구현체는 체크인 조작을 소유하는 서비스이고, 이 질문에 답하려면
 * 사진·메모 리포지토리가 더 필요하다. 한 클래스에 몰면 체크인 경로가 기록 조회 때문에 부푼다.
 */
interface ArchiveRecordFacade {
    /**
     * 회고가 읽는 근거 데이터(BR-U5-31 "근거 안에서만 쓴다").
     *
     * 좌표는 싣지 않는다 — 실적은 좌표를 들고 있지 않고 정본은 POI(C7)에 있다. 이동 거리를 재려면
     * 호출측이 `poiId` 로 좌표를 얻는다(BR-U5-43).
     */
    fun findDailyVisits(tripId: UUID): List<ArchiveDayView>
}

/** 하루치 실적. 날짜는 **여행지 기준**이다(U4 승계) — 즉석 방문은 슬롯 키가 없어 도착 시각으로 묶인다. */
data class ArchiveDayView(val date: LocalDate, val visits: List<ArchiveVisitView>)

/**
 * 실적 한 건(api-safe).
 *
 * **체류 시간을 싣지 않는다**(BR-U5-08) — 개별 방문의 체류는 화면에 나가지 않는다. 누적 평균은
 * 별개 소관이고(BR-U5-08a), 그쪽은 두 시각에서 다시 계산한다.
 */
data class ArchiveVisitView(
    val visitCheckId: UUID,
    val poiId: UUID,
    val arrivedAt: Instant?,
    val completedAt: Instant?,
    val skipped: Boolean,
    val photoCount: Int,
    val hasMemo: Boolean,
)
