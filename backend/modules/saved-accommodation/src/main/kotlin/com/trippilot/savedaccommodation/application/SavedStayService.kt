package com.trippilot.savedaccommodation.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.savedaccommodation.domain.BaseAssignmentRepository
import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.savedaccommodation.api.event.StayRegistered
import com.trippilot.savedaccommodation.domain.SavedStay
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
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
    private val bases: BaseAssignmentRepository,
    private val events: DomainEventPublisher,
    private val clock: Clock,
) {
    /**
     * 등록하고 **알린다**(TRIP-550). 발행은 **저장과 같은 트랜잭션**이다 — 밖에서 부르면 롤백된
     * 등록에 대해 알림이 나가고, 사용자는 없는 숙소의 알림을 받는다.
     *
     * 소비는 U6 몫이고 이 모듈은 notification 을 모른다 — 배달은 아웃박스 릴레이가 한다(R1).
     */
    @Transactional
    fun register(accountId: UUID, cmd: RegisterStayCommand): SavedStay {
        // 같은 외부 숙소는 계정당 1건(TRIP-1059 · QA #012 — 연타로 30행). 외부 키 없는 등록(핀 지정)은
        // 자연 키가 없어 막지 않는다. 선검사 + 유니크 번역의 이중 가드는 SavedPlaceService 선례.
        if (cmd.externalSource != null && cmd.externalId != null &&
            repo.existsByAccountAndExternal(accountId, cmd.externalSource, cmd.externalId)
        ) {
            throw ConflictDetected(message = "이미 저장한 숙소입니다.")
        }
        return try {
            doRegister(accountId, cmd)
        } catch (e: DataIntegrityViolationException) {
            // 동시 등록 경합 — 선검사를 빠져나간 레이스(ux_saved_stay_external). 500 이 아니라 409 다.
            throw ConflictDetected(message = "이미 저장한 숙소입니다.")
        }
    }

    private fun doRegister(accountId: UUID, cmd: RegisterStayCommand): SavedStay =
        repo.save(
            SavedStay.register(
                accountId, cmd.name, cmd.lat, cmd.lng, cmd.coordConfirmed,
                cmd.checkIn, cmd.checkOut, cmd.externalSource, cmd.externalId,
                cmd.registerRoute, cmd.memo, clock.instant(),
            ),
        ).also {
            events.publish(
                StayRegistered(
                    aggregateId = it.savedStayId.toString(),
                    accountId = accountId.toString(),
                    name = it.name,
                ),
            )
        }

    fun list(accountId: UUID): List<SavedStay> = repo.findByAccount(accountId)

    fun get(accountId: UUID, savedStayId: UUID): SavedStay = ownedOrNotFound(accountId, savedStayId)

    fun edit(accountId: UUID, savedStayId: UUID, cmd: EditStayCommand): SavedStay {
        val stay = ownedOrNotFound(accountId, savedStayId)
        // INV-U1-08: 거점으로 사용 중인 숙소는 좌표 확정을 해제할 수 없다(거점은 확정 좌표를 요구).
        if (!cmd.coordConfirmed && bases.existsByStayId(savedStayId)) {
            throw ConflictDetected(message = "거점으로 사용 중인 숙소는 좌표 확정을 해제할 수 없습니다.")
        }
        return repo.save(
            stay.edit(cmd.name, cmd.lat, cmd.lng, cmd.coordConfirmed, cmd.checkIn, cmd.checkOut, cmd.memo, clock.instant()),
        )
    }

    @Transactional
    fun delete(accountId: UUID, savedStayId: UUID) {
        val stay = ownedOrNotFound(accountId, savedStayId)
        // 거점으로 사용 중인 숙소 직접 삭제 차단(V2.4 DEFERRABLE FK가 커밋 시 터지는 500 대신 409).
        // '사용 중' 판정은 살아 있는 여행만 본다(TRIP-1061 (b)) — 삭제된 여행 때문에 숙소를 영영 못 지우면 안 된다.
        if (bases.existsByStayId(savedStayId)) {
            throw ConflictDetected(message = "거점으로 사용 중인 숙소는 삭제할 수 없습니다. 거점 배정을 먼저 해제하세요.")
        }
        // 가드를 통과했으면 잔존 배정 행은 전부 **삭제된 여행**의 것이다 — 의미 없는 참조라 함께
        // 지운다. 남기면 saved_stay FK 가 커밋에서 터져 사용자에게 500 이 나간다(TRIP-1061).
        bases.deleteByStayId(savedStayId)
        repo.delete(stay)
    }

    /** 존재하지 않거나 타 계정 소유면 404(존재 은닉). */
    private fun ownedOrNotFound(accountId: UUID, savedStayId: UUID): SavedStay {
        val stay = repo.findById(savedStayId) ?: throw ResourceNotFound()
        if (stay.accountId != accountId) throw ResourceNotFound()
        return stay
    }
}
