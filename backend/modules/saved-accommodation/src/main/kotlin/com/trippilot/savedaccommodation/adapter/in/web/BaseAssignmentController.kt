package com.trippilot.savedaccommodation.adapter.`in`.web

import com.trippilot.savedaccommodation.application.BaseAssignmentService
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.format.annotation.DateTimeFormat
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.LocalDate
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

    /**
     * 해소 시트의 선택 — 그 날 거점으로 쓸 숙소를 고른다(BR-U1-45 · `resolution=user_pick`).
     *
     * 날짜가 곧 리소스 키라(하루 1행) PUT 이다 — 다시 고르면 덮어쓰고, 같은 선택을 반복해도 결과가 같다.
     * 응답은 **커버리지 전체**다: 한 날을 풀면 `blocked` 가 바뀔 수 있어, 화면이 그 한 줄만 갱신하면
     * "아직 막혀 있다"를 계속 보여 주게 된다.
     */
    @PutMapping("/coverage/days/{dayDate}")
    fun resolveDay(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) dayDate: LocalDate,
        @Valid @RequestBody request: ResolveCoverageDayRequest,
    ): CoverageResponse =
        CoverageResponse.from(service.resolveDay(principal.accountId(), tripId, dayDate, request.savedStayId!!))
}
