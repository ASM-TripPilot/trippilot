package com.trippilot.reflection.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.reflection.application.ReflectionService
import com.trippilot.reflection.domain.Reflection
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.format.annotation.DateTimeFormat
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** 하루 회고(`j03`). 여행 하위 리소스. 소유 스코프(타 계정 404). */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/reflections")
class ReflectionController(private val service: ReflectionService) {

    @GetMapping
    fun list(principal: Principal, @PathVariable tripId: UUID): ReflectionListResponse =
        ReflectionListResponse(service.listByTrip(principal.accountId(), tripId).map { ReflectionResponse.from(it) })

    /** 생성·재생성. 하루 한 장이라 다시 부르면 **덮어쓴다**(BR-U5-35). */
    @PostMapping("/{dayDate}")
    fun generate(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) dayDate: LocalDate,
    ): ReflectionResponse = ReflectionResponse.from(service.generateDaily(principal.accountId(), tripId, dayDate))

    /** 사용자 수정. **초안은 남는다**(INV-U5-06) — 응답이 둘을 함께 준다. */
    @PutMapping("/{dayDate}")
    fun edit(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) dayDate: LocalDate,
        @RequestBody request: EditReflectionRequest,
    ): ReflectionResponse = ReflectionResponse.from(service.edit(principal.accountId(), tripId, dayDate, request.text))
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }

data class EditReflectionRequest(
    @field:NotBlank @field:Size(max = 4000) val text: String,
)

data class ReflectionListResponse(val items: List<ReflectionResponse>)

/**
 * 회고 한 장의 웹 표현.
 *
 * [draftNarrative] 와 [editedNarrative] 를 **둘 다** 준다(INV-U5-06) — 화면이 "생성된 것"과
 * "내가 고친 것"을 2열로 그린다. 하나로 합치면 그 비교가 사라진다.
 *
 * [source] 는 **항상** 실린다(BR-U5-33). 화면이 구분해 그리지 않더라도, 규칙 문장이 몇 %인지
 * 모르면 AI 경로를 붙일 근거가 없다.
 */
data class ReflectionResponse(
    val dayDate: LocalDate,
    /**
     * 화면이 그대로 그리는 문장(`editedNarrative ?: draftNarrative`).
     *
     * 이 필드를 서버가 내는 이유는 **표시본 선택이 업무 규칙이기 때문이다**(BR-U5-35). 클라이언트가
     * 매번 `?:` 를 다시 쓰면 조회 화면과 목록 화면이 서로 다르게 고르는 날이 온다.
     */
    val narrative: String,
    val draftNarrative: String,
    val editedNarrative: String?,
    val source: String,
    val stats: ReflectionStatsResponse,
    val generatedAt: Instant,
    val updatedAt: Instant,
) {
    companion object {
        fun from(r: Reflection) = ReflectionResponse(
            r.dayDate, r.narrative, r.draftNarrative, r.editedNarrative, r.source.name,
            ReflectionStatsResponse(
                r.stats.visitCount, r.stats.distanceKm, r.stats.distanceSource.name, r.stats.photoCount,
            ),
            r.generatedAt, r.updatedAt,
        )
    }
}

/**
 * 근거 수치. **소요시간 필드가 없다**(INV-3 · PBT-U5-5) — 거리만 낸다.
 *
 * [distanceSource] 를 함께 주는 이유는 근사와 실측을 가르기 위해서다(BR-U5-43).
 * `VISIT_LINE` 은 방문점을 이은 직선 합이지 도로 거리가 아니다.
 */
data class ReflectionStatsResponse(
    val visitCount: Int,
    val distanceKm: Double,
    val distanceSource: String,
    val photoCount: Int,
)
