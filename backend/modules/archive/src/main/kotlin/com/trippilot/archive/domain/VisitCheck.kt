package com.trippilot.archive.domain

import com.trippilot.core.error.ConflictDetected
import java.time.Duration
import java.time.Instant
import java.util.UUID

/**
 * 방문 실적(C12 Travel Archive · U5 정본 §2 · DEC-U5-2) — `actual` 계층의 첫 조각.
 * U4 가 최소 형태로 정의했고(DEC-U4-10 · 테이블은 V2.21 그대로) 소유만 U5 로 옮겨 왔다.
 *
 * 계획(`visit_slot`)과 **덮어쓰지 않는다.** 계획은 "가기로 한 것", 여기는 "실제로 간 것"이라
 * 둘이 달라도 그 자체가 사실이다(늦게 도착했다·건너뛰었다).
 *
 * **INV-U4-04**: 완료된 방문의 슬롯은 재계획에서 **불변**이다 — 이미 다녀온 곳의 시각을 바꾸면
 * 사용자가 겪은 사실과 어긋난다. 재계획(C10)은 그 판정을 [com.trippilot.archive.api.ArchiveFacade] 로
 * 읽는다 — 이 모듈이 U4 를 되부르지 않아야 순환이 생기지 않는다(BR-U5-10).
 *
 * ⚠ 사진·메모는 여기 두지 않는다 — 별도 테이블(`visit_photo_meta` · `visit_memo`)로 붙는다.
 * (번호는 적지 않는다. 정본이 제안한 V2.28 은 그 사이 `outbox_schema_version` 이 가져갔다 —
 * 마이그레이션 번호는 **머지 시점에 열린 PR 을 보고** 정하는 값이라 주석에 박아 두면 반드시 어긋난다.)
 * 메모를 이 행에 매달면 메모 편집마다 [updatedAt] 이 갱신돼 오프라인 충돌 판정이 오염된다(U5 정본 §3.2).
 */
data class VisitCheck(
    val visitCheckId: UUID,
    val tripId: UUID,
    /** 슬롯 경계 키. **즉석 방문(계획에 없던 곳)이면 null**. */
    val slotKey: String?,
    val poiId: UUID,
    val arrivedAt: Instant?,
    val completedAt: Instant?,
    /**
     * 건너뜀(취소). U4 정본 §3.1 최소 집합의 **확장**이다 — TRIP-118 이 "방문 완료/취소"를 요구하고,
     * 요약 스키마 문서도 `completed`/`skipped` 를 나눈다.
     *
     * **INV-U5-01**: 이관하면서 `status` enum 으로 흡수하지 **않는다.** 상태는 세 timestamp 에서
     * 파생한다 — 저장하면 timestamp 와 어긋날 수 있고, 어긋난 쪽이 무엇인지 나중에 알 수 없다.
     */
    val skippedAt: Instant?,
    val source: CheckSource,
    val createdAt: Instant,
    val updatedAt: Instant,
) {
    companion object {
        /** 도착 체크. 지오펜스가 깨웠거나 사용자가 직접 눌렀다. */
        fun arrive(tripId: UUID, slotKey: String?, poiId: UUID, source: CheckSource, at: Instant) =
            VisitCheck(UUID.randomUUID(), tripId, slotKey, poiId, at, null, null, source, at, at)

        fun reconstitute(
            visitCheckId: UUID, tripId: UUID, slotKey: String?, poiId: UUID,
            arrivedAt: Instant?, completedAt: Instant?, skippedAt: Instant?, source: CheckSource,
            createdAt: Instant, updatedAt: Instant,
        ) = VisitCheck(
            visitCheckId, tripId, slotKey, poiId, arrivedAt, completedAt, skippedAt, source, createdAt, updatedAt,
        )
    }

    /**
     * 방문 완료. 도착 없이 완료할 수 없다 — 그러면 [dwellMinutes] 가 계산되지 않아
     * `DELAY` 트리거 입력이 비고, "얼마나 머물렀나"를 U5 가 승계할 재료도 사라진다.
     */
    fun complete(at: Instant): VisitCheck {
        val arrived = arrivedAt ?: throw ConflictDetected(message = "도착 체크 없이 완료할 수 없습니다.")
        requireOpen()
        if (at < arrived) throw ConflictDetected(message = "완료 시각이 도착보다 앞설 수 없습니다.")
        return copy(completedAt = at, updatedAt = at)
    }

    /**
     * 건너뜀(취소). **도착 없이도 가능하다** — 계획에 있었지만 아예 안 간 경우가 그것이다.
     * 완료와 동시에 참일 수 없다(DB CHECK 도 같은 규칙) — 둘 다 있으면 "갔나 안 갔나"가 갈린다.
     */
    fun skip(at: Instant): VisitCheck {
        requireOpen()
        return copy(skippedAt = at, updatedAt = at)
    }

    /**
     * 실제 시각 보정(TRIP-118 — 자동 기록하되 **수정 가능**).
     * 기기 시각이 어긋났거나 체크를 늦게 눌렀을 때 사용자가 바로잡는 경로다.
     *
     * **null 은 "변경 없음"이다. 지우는 뜻이 아니다.** 보내지 않은 필드를 지움으로 읽으면,
     * 도착 시각만 고치려던 요청이 **완료 기록을 함께 지워** 재계획 잠금(INV-U4-04)이 풀린다.
     * 기록을 되돌리는 경로는 이 티켓의 범위가 아니라 두지 않는다.
     */
    fun adjustTimes(arrivedAt: Instant?, completedAt: Instant?, at: Instant): VisitCheck {
        val newArrived = arrivedAt ?: this.arrivedAt
        val newCompleted = completedAt ?: this.completedAt
        if (newCompleted != null && newArrived == null) {
            throw ConflictDetected(message = "완료 시각만 남길 수 없습니다 — 도착 시각이 필요합니다.")
        }
        if (newCompleted != null && newArrived != null && newCompleted < newArrived) {
            throw ConflictDetected(message = "완료 시각이 도착보다 앞설 수 없습니다.")
        }
        return copy(arrivedAt = newArrived, completedAt = newCompleted, updatedAt = at)
    }

    /** 아직 결과가 정해지지 않았는가(완료도 건너뜀도 아님). */
    private fun requireOpen() {
        if (completedAt != null) throw ConflictDetected(message = "이미 완료된 방문입니다.")
        if (skippedAt != null) throw ConflictDetected(message = "이미 건너뛴 방문입니다.")
    }

    /** 재계획에서 잠글 대상인가(INV-U4-04). 건너뛴 방문은 잠그지 않는다 — 안 갔으니 바꿔도 된다. */
    val isCompleted: Boolean get() = completedAt != null

    /** 계획에 없던 곳인가(즉석 방문, TRIP-118). */
    val isSpontaneous: Boolean get() = slotKey == null

    /**
     * 실제 체류 시간(분) — **파생값이다. 저장하지 않는다.**
     * 저장하면 두 시각과 어긋날 수 있고, 어긋났을 때 어느 쪽이 사실인지 알 수 없다.
     *
     * **INV-U4-03**: 이 값은 사용자 화면에 체류 시간으로 **표시하지 않는다** —
     * `DELAY` 트리거의 입력과 U5 기록의 재료로만 쓴다(INV-3 과 경계를 흐리지 않게).
     */
    val dwellMinutes: Long?
        get() = if (arrivedAt != null && completedAt != null) {
            Duration.between(arrivedAt, completedAt).toMinutes()
        } else {
            null
        }
}

/** 도착 감지 방식(DEC-U4-6). 권한이 없거나 정확도가 낮으면 수동으로 대체된다(BR-U4-36). */
enum class CheckSource { AUTO_GEOFENCE, MANUAL }

interface VisitCheckRepository {
    fun save(check: VisitCheck): VisitCheck

    fun findById(visitCheckId: UUID): VisitCheck?

    fun findByTrip(tripId: UUID): List<VisitCheck>

    /** 같은 슬롯의 실적. 중복 체크인을 막는 데 쓴다 — 둘이면 "완료됐나"가 갈린다. */
    fun findBySlot(tripId: UUID, slotKey: String): VisitCheck?
}
