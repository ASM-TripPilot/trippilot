package com.trippilot.savedaccommodation.adapter.`in`.web

import com.trippilot.savedaccommodation.application.BaseAssignmentService
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.util.UUID

/**
 * 구간 거점 배정 + 커버리지 — 여행 하위 리소스. 여행 소유(TripFacade)·숙소 소유 스코프(타 계정 404).
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}")
class BaseAssignmentController(
    private val service: BaseAssignmentService,
) {
    @PostMapping("/bases")
    @ResponseStatus(HttpStatus.CREATED)
    fun assign(
        principal: Principal,
        @PathVariable tripId: UUID,
        @Valid @RequestBody request: AssignBaseRequest,
    ): BaseAssignmentResponse =
        BaseAssignmentResponse.from(service.assign(principal.accountId(), tripId, request.toCommand()))

    @GetMapping("/bases")
    fun list(principal: Principal, @PathVariable tripId: UUID): List<BaseAssignmentResponse> =
        service.list(principal.accountId(), tripId).map { BaseAssignmentResponse.from(it) }

    @DeleteMapping("/bases/{baseAssignmentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(principal: Principal, @PathVariable tripId: UUID, @PathVariable baseAssignmentId: UUID) =
        service.remove(principal.accountId(), tripId, baseAssignmentId)

    @GetMapping("/coverage")
    fun coverage(principal: Principal, @PathVariable tripId: UUID): CoverageResponse =
        CoverageResponse.from(service.coverage(principal.accountId(), tripId))
}
