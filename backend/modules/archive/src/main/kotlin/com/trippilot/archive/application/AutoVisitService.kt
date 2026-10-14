package com.trippilot.archive.application

import com.trippilot.archive.api.event.VisitAutoReverted
import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.CompletionSource
import com.trippilot.archive.domain.VisitCheck
import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.archive.domain.VisitMemoRepository
import com.trippilot.archive.domain.VisitPhotoMetaRepository
import com.trippilot.archive.api.VisitConflictState
import com.trippilot.auth.api.LocationConsentFacade
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.trip.api.TripFacade
import org.slf4j.LoggerFactory
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/** 기기가 판정한 자동 도착·완료 한 건(U10 FD §12.1). 좌표가 없다(INV-U10-2). */
data class AutoVisitEvent(
    val eventId: UUID,
    val kind: AutoVisitKind,
    val slotKey: String,
    val poiId: UUID,
    val occurredAt: Instant,
    val completionSource: CompletionSource? = null,
)

enum class AutoVisitKind { ARRIVE, COMPLETE }

/** 항목별 결과(OBS-U10-06). 409 로 배치 전체를 깨지 않는다 — 항목마다 가른다. */
enum class AutoVisitOutcome { APPLIED, ALREADY_RECORDED, CONFLICT, SUPPRESSED, REJECTED_CONSENT, OUT_OF_WINDOW }

data class AutoVisitResult(val eventId: UUID, val outcome: AutoVisitOutcome, val visitCheck: VisitCheck?)

data class AutoVisitBatchResult(val results: List<AutoVisitResult>, val automationEnabled: Boolean)

/**
 * 자동 방문 결과 배치와 자동 기록 되돌리기(U10 FD §5·§6·§12.1·§12.2 · BR-U10-20·21·29·31·32).
 *
 * **서버 우선**(INV-U10-6) — 서버에 이미 있는 기록은 자동 결과가 바꾸지 않는다. 유일한 예외는 수동 도착 + 미완료 행에 자동 완료를
 * 더하는 것(§5.2). **멱등**은 영수증 테이블 없이 `(trip_id, slot_key)` 상태로 수렴시킨다 — 같은 배치를 몇 번 보내도 최종 상태가
 * 같다(PBT-U10-3). **항목마다 트랜잭션** — 한 항목의 실패가 다른 항목을 막지 않는다(BR-U10-20).
 */
@Service
class AutoVisitService(
    private val trips: TripFacade,
    private val plans: ItineraryPlanFacade,
    private val checks: VisitCheckRepository,
    private val photos: VisitPhotoMetaRepository,
    private val memos: VisitMemoRepository,
    private val consents: LocationConsentFacade,
    private val events: DomainEventPublisher,
    private val properties: LocationAutomationProperties,
    private val clock: Clock,
    transactionManager: PlatformTransactionManager,
) {
    private val tx = TransactionTemplate(transactionManager)

    fun apply(accountId: UUID, tripId: UUID, batch: List<AutoVisitEvent>): AutoVisitBatchResult {
        if (batch.size > MAX_BATCH) throw ValidationFailed(listOf(FieldError("events", "한 번에 ${MAX_BATCH}건까지입니다.")))
        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        // 킬 스위치가 꺼져도 이미 생긴 큐 항목은 처리한다 — 데이터를 버리지 않는다(REL-U10-06). 꺼졌다는 사실만 싣는다.
        val enabled = properties.enabled
        // 동의는 배치 단위로 한 번 본다 — L2 가 없으면 전 항목을 거절한다(BR-U10-45). 좌표가 없어도 위치 "이용"의 결과다.
        if (!consents.hasLocationLegalConsent(accountId)) {
            return AutoVisitBatchResult(batch.map { e -> AutoVisitResult(e.eventId, AutoVisitOutcome.REJECTED_CONSENT, null).also { observe(e, it) } }, enabled)
        }
        val planned = plans.findPlanSlots(accountId, tripId).associateBy { it.slotKey }
        val now = clock.instant()
        val results = batch.map { event ->
            val outcome = when {
                planned[event.slotKey]?.poiId != event.poiId -> AutoVisitResult(event.eventId, AutoVisitOutcome.CONFLICT, null) // 일정에 없는 슬롯
                !inWindow(event, planned.getValue(event.slotKey).date, period.startDate, period.endDate, now) ->
                    AutoVisitResult(event.eventId, AutoVisitOutcome.OUT_OF_WINDOW, null)
                else -> try {
                    tx.execute { applyOne(accountId, tripId, event) }!!
                } catch (_: DataIntegrityViolationException) {
                    // 같은 슬롯을 다른 요청(다른 배치·수동 도착·건너뛰기)이 방금 만들었다 — 이 항목의 트랜잭션만 되돌려졌다. 한 번 더 판정하면
                    // 이긴 쪽의 행을 보고 제 결과(이미 도착 → ALREADY_RECORDED, 건너뜀 → CONFLICT …)를 낸다.
                    tx.execute { applyOne(accountId, tripId, event) }!!
                }
            }
            observe(event, outcome)
            outcome
        }
        return AutoVisitBatchResult(results, enabled)
    }

    /** BR-U10-21 — 여행 날짜 구간 밖 · 슬롯 날짜와 다른 날 · 서버 시각 + 5분보다 미래는 받지 않는다. */
    private fun inWindow(event: AutoVisitEvent, slotDay: LocalDate, start: LocalDate, end: LocalDate, now: Instant): Boolean {
        val day = LocalDate.ofInstant(event.occurredAt, TRAVEL_ZONE)
        return day == slotDay && day >= start && day <= end && event.occurredAt <= now + CLOCK_SKEW
    }

    private fun applyOne(accountId: UUID, tripId: UUID, event: AutoVisitEvent): AutoVisitResult {
        // 잠그고 읽는다 — 읽고 저장하는 사이 수동 완료·건너뜀이 끼면 낡은 사본으로 덮는다(행 전체를 쓴다, INV-U10-6).
        val existing = checks.findBySlotForUpdate(tripId, event.slotKey)
        fun result(outcome: AutoVisitOutcome, check: VisitCheck? = existing) = AutoVisitResult(event.eventId, outcome, check)
        // 그날 자동 기록을 되돌린 슬롯 — 자동 쓰기를 거절한다(INV-U10-10). 수동 도착으로 재사용된 행도 표식은 남아 있다.
        if (existing?.autoSuppressedAt != null) return result(AutoVisitOutcome.SUPPRESSED)
        return when (event.kind) {
            AutoVisitKind.ARRIVE -> when {
                existing == null -> {
                    val created = checks.save(VisitCheck.arrive(tripId, event.slotKey, event.poiId, CheckSource.AUTO_GEOFENCE, event.occurredAt))
                    events.publish(created.checkedEvent(accountId))
                    result(AutoVisitOutcome.APPLIED, created)
                }
                existing.skippedAt != null -> result(AutoVisitOutcome.CONFLICT)
                // 이미 도착이 있다(수동이든 앞선 같은 배치든) — 서버 값이 이긴다. 재전송은 여기로 수렴한다.
                else -> result(AutoVisitOutcome.ALREADY_RECORDED)
            }
            AutoVisitKind.COMPLETE -> {
                val by = event.completionSource?.takeIf { it != CompletionSource.MANUAL }
                when {
                    by == null -> result(AutoVisitOutcome.CONFLICT) // 자동 완료인데 자동 출처가 없다 — 기기 결함
                    existing?.arrivedAt == null -> result(AutoVisitOutcome.CONFLICT) // 도착보다 먼저 온 완료(§12.1)
                    existing.skippedAt != null -> result(AutoVisitOutcome.CONFLICT)
                    existing.completedAt != null -> result(AutoVisitOutcome.ALREADY_RECORDED) // 어느 출처든 이미 완료 — 서버 우선
                    event.occurredAt < existing.arrivedAt -> result(AutoVisitOutcome.OUT_OF_WINDOW) // 도착보다 앞선 완료(BR-U10-21)
                    else -> {
                        // 수동 도착 + 미완료에 자동 완료를 더하는 것만 서버 값을 바꾸는 예외다(§5.2) — 체류 기준은 서버의 도착 시각.
                        val completed = checks.save(existing.complete(event.occurredAt, by))
                        events.publish(completed.checkedEvent(accountId))
                        result(AutoVisitOutcome.APPLIED, completed)
                    }
                }
            }
        }
    }

    /**
     * 자동 기록 되돌리기(§12.2 · BR-U10-31). 자동 도착을 비우려는데 사진·메모가 붙어 있으면 409 `VISIT_HAS_MEDIA` —
     * 기록을 조용히 잃지 않는다(먼저 지우라고 안내). 되돌린 뒤 `VisitAutoReverted` 를 같은 트랜잭션에서 낸다.
     */
    @Transactional
    fun revert(accountId: UUID, tripId: UUID, visitCheckId: UUID, expectedUpdatedAt: Instant? = null): VisitCheck {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        val current = checks.findById(visitCheckId)?.takeIf { it.tripId == tripId } ?: throw ResourceNotFound("방문 기록을 찾을 수 없습니다.")
        // 무엇을 되돌릴지가 **지금 상태**로 정해진다 — 두 번 누르거나 응답을 못 받고 다시 보내면 완료에 이어 도착까지 지워진다.
        // 화면이 본 상태(`updatedAt`)를 함께 보내면 그 사이 바뀐 것을 409 로 가른다(BR-U5-22 와 같은 판정).
        // 1µs 미만은 같은 값이다 — 쓰기 응답의 시각은 시계 그대로(Linux 는 나노초)이고 DB 는 마이크로초로 반올림해 저장한다. 정확 비교면
        // 응답 값을 그대로 돌려보낸 정상 요청이 늘 409 다(anti-patterns — 타임스탬프 정확 비교).
        if (expectedUpdatedAt != null && Duration.between(current.updatedAt, expectedUpdatedAt).abs() >= Duration.ofNanos(1_000)) {
            throw ConflictDetected(
                current = VisitConflictState(current.visitCheckId, current.updatedAt),
                message = "그 사이 방문 기록이 바뀌었습니다.", errorCode = ErrorCode.VISIT_CONFLICT,
            )
        }
        val revertsArrival = current.completedAt == null && current.source == CheckSource.AUTO_GEOFENCE
        if (revertsArrival && (photos.findByVisit(visitCheckId).isNotEmpty() || memos.find(visitCheckId) != null)) {
            throw ConflictDetected(
                current = VisitConflictState(current.visitCheckId, current.updatedAt),
                message = "사진이나 메모가 붙은 방문입니다. 먼저 지운 뒤 되돌려 주세요.", errorCode = ErrorCode.VISIT_HAS_MEDIA,
            )
        }
        val (reverted, part) = current.revertAuto(clock.instant())
        val saved = checks.save(reverted)
        events.publish(VisitAutoReverted(saved.visitCheckId.toString(), tripId.toString(), accountId.toString(), saved.slotKey, revertedPart = part.name))
        log.info("u10.auto_revert part={}", part)
        return saved
    }

    /** 사건마다 INFO 한 줄(인프라 U10 로그 규약) — 좌표·계정 id 없음. */
    private fun observe(event: AutoVisitEvent, r: AutoVisitResult) =
        log.info("u10.auto_event kind={} completionSource={} outcome={}", event.kind, event.completionSource ?: "-", r.outcome)

    companion object {
        const val MAX_BATCH = 50
        private val log = LoggerFactory.getLogger(AutoVisitService::class.java)
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

        /** 기기 시계가 서버보다 이만큼 앞서는 것은 받는다(BR-U10-21). */
        private val CLOCK_SKEW: Duration = Duration.ofMinutes(5)
    }
}
