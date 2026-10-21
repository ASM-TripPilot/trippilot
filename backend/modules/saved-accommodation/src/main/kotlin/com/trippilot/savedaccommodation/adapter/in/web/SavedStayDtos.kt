package com.trippilot.savedaccommodation.adapter.`in`.web

import com.trippilot.savedaccommodation.application.EditStayCommand
import com.trippilot.savedaccommodation.application.RegisterStayCommand
import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.savedaccommodation.domain.SavedStay
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotNull
import jakarta.validation.constraints.Size
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 숙소 등록(3경로). 좌표·날짜는 선택. 교차 검증(날짜·좌표)은 도메인이 수행.
 * 문자열 상한은 `saved_stay` 컬럼 폭이다 — 없으면 넘친 입력이 22001 로 저장에서 터졌고, 서비스의 경합 처리가
 * 그것을 "이미 저장한 숙소" 409 로 잘못 알렸다(TRIP-1473).
 */
data class RegisterSavedStayRequest(
    @field:NotBlank @field:Size(max = 200, message = "숙소 이름은 200자 이하입니다.") val name: String?,
    @field:NotNull val registerRoute: RegisterRoute?,
    val lat: Double? = null,
    val lng: Double? = null,
    val coordConfirmed: Boolean = false,
    val checkIn: LocalDate? = null,
    val checkOut: LocalDate? = null,
    @field:Size(max = 40, message = "외부 출처는 40자 이하입니다.") val externalSource: String? = null,
    @field:Size(max = 120, message = "외부 식별자는 120자 이하입니다.") val externalId: String? = null,
    @field:Size(max = 500, message = "메모는 500자 이하입니다.") val memo: String? = null,
) {
    fun toCommand() = RegisterStayCommand(
        name = name!!, lat = lat, lng = lng, coordConfirmed = coordConfirmed,
        checkIn = checkIn, checkOut = checkOut, externalSource = externalSource,
        externalId = externalId, registerRoute = registerRoute!!, memo = memo,
    )
}

/** 숙소 편집 — 가변 필드 전체 제공(제공 상태로 대체). 상한은 등록과 같다. */
data class EditSavedStayRequest(
    @field:NotBlank @field:Size(max = 200, message = "숙소 이름은 200자 이하입니다.") val name: String?,
    val lat: Double? = null,
    val lng: Double? = null,
    val coordConfirmed: Boolean = false,
    val checkIn: LocalDate? = null,
    val checkOut: LocalDate? = null,
    @field:Size(max = 500, message = "메모는 500자 이하입니다.") val memo: String? = null,
) {
    fun toCommand() = EditStayCommand(
        name = name!!, lat = lat, lng = lng, coordConfirmed = coordConfirmed,
        checkIn = checkIn, checkOut = checkOut, memo = memo,
    )
}

data class SavedStayResponse(
    val savedStayId: UUID,
    val name: String,
    val lat: Double?,
    val lng: Double?,
    val coordConfirmed: Boolean,
    val checkIn: LocalDate?,
    val checkOut: LocalDate?,
    val externalSource: String?,
    val externalId: String?,
    val registerRoute: RegisterRoute,
    val memo: String?,
    val createdAt: Instant,
    val updatedAt: Instant,
    /**
     * 이 숙소가 거점인 여행들(BR-U6-20). 비어 있으면 화면이 `연결된 여행 없음` 을 그린다.
     * 삭제된 여행은 빠진다 — 열 수 없는 여행을 붙여 두면 사용자가 막다른 길로 간다.
     */
    val linkedTripIds: List<UUID>,
) {
    companion object {
        /**
         * [linkedTripIds] 에 **기본값을 두지 않는다.** 기본값을 두면 새 표면이 그것을 물려받아
         * 거점으로 쓰이는 숙소에 빈 목록을 실어 보낸다 — 화면이 그 응답으로 캐시를 갱신하면
         * `연결된 여행 없음` 이 된다. 부르는 쪽이 매번 무엇인지 말하게 한다.
         */
        fun from(s: SavedStay, linkedTripIds: List<UUID>) = SavedStayResponse(
            savedStayId = s.savedStayId, name = s.name, lat = s.lat, lng = s.lng,
            coordConfirmed = s.coordConfirmed, checkIn = s.checkIn, checkOut = s.checkOut,
            externalSource = s.externalSource, externalId = s.externalId,
            registerRoute = s.registerRoute, memo = s.memo, createdAt = s.createdAt, updatedAt = s.updatedAt,
            linkedTripIds = linkedTripIds,
        )
    }
}
