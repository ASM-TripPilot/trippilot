package com.trippilot.savedaccommodation.adapter.`in`.web

import com.trippilot.savedaccommodation.application.EditStayCommand
import com.trippilot.savedaccommodation.application.RegisterStayCommand
import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.savedaccommodation.domain.SavedStay
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotNull
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** 숙소 등록(3경로). 좌표·날짜는 선택. 교차 검증(날짜·좌표)은 도메인이 수행. */
data class RegisterSavedStayRequest(
    @field:NotBlank val name: String?,
    @field:NotNull val registerRoute: RegisterRoute?,
    val lat: Double? = null,
    val lng: Double? = null,
    val coordConfirmed: Boolean = false,
    val checkIn: LocalDate? = null,
    val checkOut: LocalDate? = null,
    val externalSource: String? = null,
    val externalId: String? = null,
    val memo: String? = null,
) {
    fun toCommand() = RegisterStayCommand(
        name = name!!, lat = lat, lng = lng, coordConfirmed = coordConfirmed,
        checkIn = checkIn, checkOut = checkOut, externalSource = externalSource,
        externalId = externalId, registerRoute = registerRoute!!, memo = memo,
    )
}

/** 숙소 편집 — 가변 필드 전체 제공(제공 상태로 대체). */
data class EditSavedStayRequest(
    @field:NotBlank val name: String?,
    val lat: Double? = null,
    val lng: Double? = null,
    val coordConfirmed: Boolean = false,
    val checkIn: LocalDate? = null,
    val checkOut: LocalDate? = null,
    val memo: String? = null,
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
) {
    companion object {
        fun from(s: SavedStay) = SavedStayResponse(
            savedStayId = s.savedStayId, name = s.name, lat = s.lat, lng = s.lng,
            coordConfirmed = s.coordConfirmed, checkIn = s.checkIn, checkOut = s.checkOut,
            externalSource = s.externalSource, externalId = s.externalId,
            registerRoute = s.registerRoute, memo = s.memo, createdAt = s.createdAt, updatedAt = s.updatedAt,
        )
    }
}
