package com.trippilot.archive.adapter.`in`.web

import com.trippilot.archive.application.AutoVisitEvent
import com.trippilot.archive.application.AutoVisitKind
import com.trippilot.archive.application.AutoVisitService
import com.trippilot.archive.domain.CompletionSource
import com.trippilot.core.error.AuthenticationRequired
import jakarta.validation.Valid
import jakarta.validation.constraints.NotNull
import jakarta.validation.constraints.Size
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.util.UUID

/** 자동 방문 결과(U10 FD §12.1·§12.2). 기기가 판정한 도착·완료를 배치로 올리고, 자동 기록을 되돌린다. 좌표는 받지 않는다. */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/visits")
class AutoVisitController(private val service: AutoVisitService) {

    @PostMapping("/auto-events")
    fun apply(principal: Principal, @PathVariable tripId: UUID, @Valid @RequestBody request: AutoVisitBatchRequest): AutoVisitBatchResponse {
        val result = service.apply(
            principal.accountId(), tripId,
            request.events!!.map { e ->
                // 원소 null 은 @Valid 가 건너뛴다 — 넘기면 NPE 로 500 이 된다
                e ?: throw ValidationFailed(listOf(FieldError("events", "빈 항목이 있습니다.")))
                AutoVisitEvent(e.eventId!!, e.kind!!, e.slotKey!!, e.poiId!!, e.occurredAt!!, e.completionSource)
            },
        )
        return AutoVisitBatchResponse(
            result.results.map { AutoVisitResultResponse(it.eventId, it.outcome.name, it.visitCheck?.let(VisitCheckResponse::from)) },
            result.automationEnabled,
        )
    }

    /** `expectedUpdatedAt` — 화면이 본 기록의 `updatedAt`. 주면 그 사이 바뀐 것(다른 기기의 되돌리기·두 번 누르기)을 409 로 가른다. */
    @PostMapping("/{visitCheckId}/revert-auto")
    fun revert(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable visitCheckId: UUID,
        @RequestParam(required = false) expectedUpdatedAt: Instant?,
    ): VisitCheckResponse = VisitCheckResponse.from(service.revert(principal.accountId(), tripId, visitCheckId, expectedUpdatedAt))

    private fun Principal.accountId(): UUID =
        runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
}

data class AutoVisitBatchRequest(
    @field:NotNull @field:Size(max = AutoVisitService.MAX_BATCH) @field:Valid val events: List<AutoVisitEventRequest?>?,
)

data class AutoVisitEventRequest(
    @field:NotNull val eventId: UUID?,
    @field:NotNull val kind: AutoVisitKind?,
    @field:NotNull val slotKey: String?,
    @field:NotNull val poiId: UUID?,
    @field:NotNull val occurredAt: Instant?,
    val completionSource: CompletionSource? = null,
)

/** 항목별 결과 + 서버 킬 스위치 상태(REL-U10-06) — `false` 면 기기는 강등한다. */
data class AutoVisitBatchResponse(val results: List<AutoVisitResultResponse>, val automationEnabled: Boolean)

data class AutoVisitResultResponse(val eventId: UUID, val outcome: String, val visitCheck: VisitCheckResponse?)
