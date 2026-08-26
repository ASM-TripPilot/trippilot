package com.trippilot.archive.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.archive.application.VisitCheckService
import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.VisitCheck
import jakarta.validation.Valid
import jakarta.validation.constraints.NotNull
import org.springframework.format.annotation.DateTimeFormat
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 방문 실적 — 도착·완료·건너뜀·시각 보정(US-ONTRIP-01 · US-REC-01).
 *
 * 계획(`visit_slot`)을 **덮어쓰지 않는다.** 계획은 "가기로 한 것", 여기는 "실제로 간 것"이라
 * 둘이 달라도 그 자체가 사실이다(늦게 도착했다·건너뛰었다).
 *
 * 실적 id 가 전역 유일해도 **여행 아래로 중첩**한다 — 소유 검증이 한 곳에서 끝난다(재계획 세션과 같은 이유).
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/visits")
class VisitCheckController(private val service: VisitCheckService) {

    /** 도착 체크. 계획에 없던 곳이면 `slotKey` 를 비워 **즉석 방문**으로 남긴다(US-REC-01). */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun arrive(
        principal: Principal,
        @PathVariable tripId: UUID,
        @Valid @RequestBody request: ArriveRequest,
    ): VisitCheckResponse = VisitCheckResponse.from(
        service.arrive(principal.accountId(), tripId, request.slotKey, request.poiId!!, request.source!!),
    )

    /** 그 날의 방문 기록. 즉석 방문은 슬롯 키가 없어 **도착 시각(여행지 기준)** 으로 묶인다. */
    @GetMapping("/days/{day}")
    fun listByDay(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) day: LocalDate,
    ): VisitCheckListResponse =
        VisitCheckListResponse(service.listByDay(principal.accountId(), tripId, day).map { VisitCheckResponse.from(it) })

    /** 방문 완료. 이 시점부터 그 슬롯은 재계획에서 불변이다(INV-U4-04). */
    @PostMapping("/{visitCheckId}/complete")
    fun complete(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable visitCheckId: UUID,
    ): VisitCheckResponse = VisitCheckResponse.from(service.complete(principal.accountId(), tripId, visitCheckId))

    /** 건너뜀(취소). 안 갔으므로 재계획에서 잠그지 않는다. */
    @PostMapping("/{visitCheckId}/skip")
    fun skip(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable visitCheckId: UUID,
    ): VisitCheckResponse = VisitCheckResponse.from(service.skip(principal.accountId(), tripId, visitCheckId))

    /** 실제 시각 보정 — 자동 기록하되 사용자가 고칠 수 있다(US-REC-01). */
    @PatchMapping("/{visitCheckId}")
    fun adjust(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable visitCheckId: UUID,
        @RequestBody request: AdjustTimesRequest,
    ): VisitCheckResponse = VisitCheckResponse.from(
        service.adjustTimes(principal.accountId(), tripId, visitCheckId, request.arrivedAt, request.completedAt),
    )
}

/**
 * 도착 체크 요청.
 * [slotKey] 를 비우면 **즉석 방문**이다 — 계획에 없던 곳을 그 자리에서 남기는 경로(US-REC-01).
 */
data class ArriveRequest(
    val slotKey: String? = null,
    @field:NotNull(message = "장소는 필수입니다.") val poiId: UUID?,
    @field:NotNull(message = "체크 방식은 필수입니다.") val source: CheckSource?,
)

/**
 * 시각 보정 요청. **보내지 않은 값은 그대로 둔다**(null = 변경 없음).
 *
 * 지움으로 읽으면 도착만 고치려던 요청이 완료 기록을 함께 지워, 재계획 잠금(INV-U4-04)이
 * 조용히 풀린다. 기록을 되돌리는 경로는 이 티켓 범위가 아니다.
 */
data class AdjustTimesRequest(val arrivedAt: Instant? = null, val completedAt: Instant? = null)

data class VisitCheckListResponse(val visits: List<VisitCheckResponse>)

data class VisitCheckResponse(
    val visitCheckId: UUID,
    /** null = 즉석 방문(계획에 없던 곳). */
    val slotKey: String?,
    val poiId: UUID,
    val arrivedAt: Instant?,
    val completedAt: Instant?,
    val skippedAt: Instant?,
    val source: CheckSource,
    /** 계획에 없던 곳인가 — 화면이 '즉석 방문' 배지를 그리는 근거. */
    val spontaneous: Boolean,
) {
    companion object {
        /**
         * **체류 시간(dwellMinutes)은 싣지 않는다**(INV-U4-03) — `DELAY` 트리거 입력과
         * U5 기록의 재료로만 쓰고, U4 화면에서는 노출해 INV-3 과 경계를 흐리지 않는다.
         */
        fun from(v: VisitCheck) = VisitCheckResponse(
            v.visitCheckId, v.slotKey, v.poiId, v.arrivedAt, v.completedAt, v.skippedAt, v.source, v.isSpontaneous,
        )
    }
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
