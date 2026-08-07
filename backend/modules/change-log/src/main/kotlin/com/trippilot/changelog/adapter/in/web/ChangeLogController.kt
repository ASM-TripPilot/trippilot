package com.trippilot.changelog.adapter.`in`.web

import com.trippilot.changelog.api.ItinerarySnapshotView
import com.trippilot.changelog.application.ChangeLogService
import com.trippilot.changelog.domain.ChangeLogEntry
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.util.UUID

/** 변경 이력 타임라인 — 여행 하위 리소스. 소유 스코프(타 계정 404). 최신순. */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/change-log")
class ChangeLogController(private val service: ChangeLogService) {

    @GetMapping
    fun timeline(principal: Principal, @PathVariable tripId: UUID): ChangeLogResponse =
        ChangeLogResponse(service.timeline(UUID.fromString(principal.name), tripId).map { ChangeLogEntryResponse.from(it) })
}

data class ChangeLogResponse(val entries: List<ChangeLogEntryResponse>)

/** [reason] 은 수동 편집이면 null 일 수 있다. [before]/[after] 는 변경 전후 스냅숏 전체. */
data class ChangeLogEntryResponse(
    val entryId: Long?,
    val actor: String,
    val sourceType: String,
    val reason: String?,
    val at: Instant,
    val before: ItinerarySnapshotView,
    val after: ItinerarySnapshotView,
) {
    companion object {
        fun from(e: ChangeLogEntry) =
            ChangeLogEntryResponse(e.entryId, e.actor, e.sourceType.name, e.reason, e.at, e.before, e.after)
    }
}
