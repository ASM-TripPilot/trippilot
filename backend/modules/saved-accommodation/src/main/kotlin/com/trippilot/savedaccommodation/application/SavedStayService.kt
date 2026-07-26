package com.trippilot.savedaccommodation.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.savedaccommodation.domain.SavedStay
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.LocalDate
import java.util.UUID

/** 등록 요청(3경로). 좌표·날짜는 선택. */
data class RegisterStayCommand(
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
)

/** 편집 요청 — 가변 필드 전체(제공 상태로 대체). */
data class EditStayCommand(
    val name: String,
    val lat: Double?,
    val lng: Double?,
    val coordConfirmed: Boolean,
    val checkIn: LocalDate?,
    val checkOut: LocalDate?,
    val memo: String?,
)

/**
 * 저장/등록 숙소(C4). 모든 조회·수정은 **소유 계정 스코프** — 타 계정 리소스는 404(BR-U1-56, 존재 은닉).
 * 이벤트(StayRegistered/StayUpdated)는 소비자(U3/U6) 도입 시 발행 — 현재 이연.
 */
@Service
class SavedStayService(
    private val repo: SavedStayRepository,
    private val clock: Clock,
) {
    fun register(accountId: UUID, cmd: RegisterStayCommand): SavedStay =
        repo.save(
            SavedStay.register(
                accountId, cmd.name, cmd.lat, cmd.lng, cmd.coordConfirmed,
                cmd.checkIn, cmd.checkOut, cmd.externalSource, cmd.externalId,
                cmd.registerRoute, cmd.memo, clock.instant(),
            ),
        )

    fun list(accountId: UUID): List<SavedStay> = repo.findByAccount(accountId)

    fun get(accountId: UUID, savedStayId: UUID): SavedStay = ownedOrNotFound(accountId, savedStayId)

    fun edit(accountId: UUID, savedStayId: UUID, cmd: EditStayCommand): SavedStay {
        val stay = ownedOrNotFound(accountId, savedStayId)
        return repo.save(
            stay.edit(cmd.name, cmd.lat, cmd.lng, cmd.coordConfirmed, cmd.checkIn, cmd.checkOut, cmd.memo, clock.instant()),
        )
    }

    fun delete(accountId: UUID, savedStayId: UUID) {
        repo.delete(ownedOrNotFound(accountId, savedStayId))
    }

    /** 존재하지 않거나 타 계정 소유면 404(존재 은닉). */
    private fun ownedOrNotFound(accountId: UUID, savedStayId: UUID): SavedStay {
        val stay = repo.findById(savedStayId) ?: throw ResourceNotFound()
        if (stay.accountId != accountId) throw ResourceNotFound()
        return stay
    }
}
