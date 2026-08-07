package com.trippilot.changelog.adapter.`in`.web

import com.trippilot.changelog.application.ChangeLogService
import com.trippilot.changelog.domain.ChangeLogEntry
import com.trippilot.changelog.domain.ItinerarySnapshot
import com.trippilot.core.error.AuthenticationRequired
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** 변경 이력 타임라인 — 여행 하위 리소스. 소유 스코프(타 계정 404). 최신순. */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/change-log")
class ChangeLogController(private val service: ChangeLogService) {

    @GetMapping
    fun timeline(
        principal: Principal,
        @PathVariable tripId: UUID,
        @RequestParam(required = false, defaultValue = "${ChangeLogService.DEFAULT_LIMIT}") limit: Int,
    ): ChangeLogResponse =
        ChangeLogResponse(service.timeline(principal.accountId(), tripId, limit).map { ChangeLogEntryResponse.from(it) })
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }

data class ChangeLogResponse(val entries: List<ChangeLogEntryResponse>)

/**
 * 이력 한 건의 웹 표현. [reason] 은 수동 편집이면 null 일 수 있다.
 * 내부 식별자(IDENTITY)는 노출하지 않는다 — 전 플랫폼 단조 증가라 편집량이 새어 나간다.
 */
data class ChangeLogEntryResponse(
    val actor: String,
    val sourceType: String,
    val reason: String?,
    val at: Instant,
    val before: SnapshotResponse,
    val after: SnapshotResponse,
) {
    companion object {
        fun from(e: ChangeLogEntry) =
            ChangeLogEntryResponse(e.actor, e.source.name, e.reason, e.at, SnapshotResponse.from(e.before), SnapshotResponse.from(e.after))
    }
}

data class SnapshotResponse(val days: List<SnapshotDayResponse>) {
    companion object {
        fun from(s: ItinerarySnapshot) = SnapshotResponse(
            s.days.map { d ->
                SnapshotDayResponse(d.date, d.slots.map { SnapshotSlotResponse(it.poiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay) })
            },
        )
    }
}

data class SnapshotDayResponse(val date: LocalDate, val slots: List<SnapshotSlotResponse>)

/** 시각·순서만(INV-2) · 소요시간 없음(INV-3). */
data class SnapshotSlotResponse(
    val poiId: UUID,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val isFixed: Boolean,
    val endsNextDay: Boolean,
)
