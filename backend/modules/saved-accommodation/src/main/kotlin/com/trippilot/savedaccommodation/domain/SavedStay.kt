package com.trippilot.savedaccommodation.domain

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** 등록 3경로(BR-U1-21): 지도검색 · 링크붙여넣기 · 핀지정. */
enum class RegisterRoute { MAP_SEARCH, LINK_PASTE, PIN }

/**
 * 저장/등록 숙소(C4). 앱 소유 · 등록 시점 값 보존(외부 조회 불가해져도 사용).
 * 불변식:
 * - INV-U1-09 체크아웃 > 체크인(둘 다 있을 때). 날짜 없이 저장 허용(거점 배정만 불가 — TRIP-178).
 * - 좌표 쌍(lat/lng 함께) + coord_confirmed ⟹ 좌표 존재(INV-U1-08 대응). 미확정 저장 허용.
 */
class SavedStay private constructor(
    val savedStayId: UUID,
    val accountId: UUID,
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
    /** 편집(PATCH) — 가변 필드(이름·좌표·확정·날짜·메모)를 갱신. 경로·외부ID·생성시각은 불변. */
    fun edit(
        name: String,
        lat: Double?,
        lng: Double?,
        coordConfirmed: Boolean,
        checkIn: LocalDate?,
        checkOut: LocalDate?,
        memo: String?,
        now: Instant,
    ): SavedStay {
        validate(name, lat, lng, coordConfirmed, checkIn, checkOut)
        return SavedStay(
            savedStayId, accountId, name, lat, lng, coordConfirmed, checkIn, checkOut,
            externalSource, externalId, registerRoute, memo, createdAt, now,
        )
    }

    companion object {
        fun register(
            accountId: UUID,
            name: String,
            lat: Double?,
            lng: Double?,
            coordConfirmed: Boolean,
            checkIn: LocalDate?,
            checkOut: LocalDate?,
            externalSource: String?,
            externalId: String?,
            registerRoute: RegisterRoute,
            memo: String?,
            now: Instant,
        ): SavedStay {
            validate(name, lat, lng, coordConfirmed, checkIn, checkOut)
            return SavedStay(
                UUID.randomUUID(), accountId, name, lat, lng, coordConfirmed, checkIn, checkOut,
                externalSource, externalId, registerRoute, memo, now, now,
            )
        }

        @Suppress("LongParameterList")
        fun reconstitute(
            savedStayId: UUID, accountId: UUID, name: String, lat: Double?, lng: Double?,
            coordConfirmed: Boolean, checkIn: LocalDate?, checkOut: LocalDate?,
            externalSource: String?, externalId: String?, registerRoute: RegisterRoute,
            memo: String?, createdAt: Instant, updatedAt: Instant,
        ): SavedStay = SavedStay(
            savedStayId, accountId, name, lat, lng, coordConfirmed, checkIn, checkOut,
            externalSource, externalId, registerRoute, memo, createdAt, updatedAt,
        )

        private fun validate(
            name: String, lat: Double?, lng: Double?, coordConfirmed: Boolean,
            checkIn: LocalDate?, checkOut: LocalDate?,
        ) {
            val errors = mutableListOf<FieldError>()
            if (name.isBlank()) errors += FieldError("name", "이름은 필수입니다.")
            if ((lat == null) != (lng == null)) errors += FieldError("coord", "위도·경도는 함께 지정해야 합니다.")
            if (coordConfirmed && lat == null) errors += FieldError("coordConfirmed", "좌표 확정은 좌표가 있어야 합니다.")
            if (checkIn != null && checkOut != null && !checkOut.isAfter(checkIn)) {
                errors += FieldError("checkOut", "체크아웃은 체크인보다 뒤여야 합니다.")
            }
            if (errors.isNotEmpty()) throw ValidationFailed(errors)
        }
    }
}
