package com.trippilot.savedaccommodation.adapter.out.persistence

import com.trippilot.savedaccommodation.domain.DuplicateExternalStay
import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.savedaccommodation.domain.SavedStay
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import org.hibernate.exception.ConstraintViolationException
import org.postgresql.util.PSQLException
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.util.UUID

interface SavedStayJpaRepository : JpaRepository<SavedStayEntity, UUID> {
    fun findByAccountId(accountId: UUID): List<SavedStayEntity>
    fun existsByAccountIdAndExternalSourceAndExternalId(accountId: UUID, externalSource: String, externalId: String): Boolean
}

@Component
class SavedStayRepositoryAdapter(
    private val jpa: SavedStayJpaRepository,
) : SavedStayRepository {

    // saveAndFlush — ux_saved_stay_external 위반(동시 등록 경합)을 커밋 전에 표면화해 서비스가
    // 409 로 변환할 수 있게(TRIP-1059 · SavedPlaceRepositoryAdapter 선례). 커밋까지 미루면
    // DataIntegrityViolation 이 @Transactional 경계에서 터져 catch 를 비껴가 500 이 된다.
    //
    // 유니크 위반은 **ux_saved_stay_external 일 때만** 도메인 신호로 바꾼다 — 다른 위반(길이 22001·CHECK)까지 중복으로 읽으면
    // 결함이 "이미 저장한 숙소" 409 로 가려진다(TRIP-1473 실측). 나머지는 그대로 올린다.
    override fun save(stay: SavedStay): SavedStay = try {
        jpa.saveAndFlush(stay.toEntity()).toDomain()
    } catch (e: DataIntegrityViolationException) {
        if (e.violatesConstraint(EXTERNAL_UNIQUE)) throw DuplicateExternalStay(e)
        throw e
    }

    override fun findById(savedStayId: UUID): SavedStay? =
        jpa.findById(savedStayId).orElse(null)?.toDomain()

    override fun findByAccount(accountId: UUID): List<SavedStay> =
        jpa.findByAccountId(accountId).map { it.toDomain() }

    override fun delete(stay: SavedStay) = jpa.deleteById(stay.savedStayId)

    override fun existsByAccountAndExternal(accountId: UUID, externalSource: String, externalId: String): Boolean =
        jpa.existsByAccountIdAndExternalSourceAndExternalId(accountId, externalSource, externalId)

    private fun SavedStay.toEntity() = SavedStayEntity(
        savedStayId = savedStayId, accountId = accountId, name = name, lat = lat, lng = lng,
        coordConfirmed = coordConfirmed, checkIn = checkIn, checkOut = checkOut,
        externalSource = externalSource, externalId = externalId, registerRoute = registerRoute.name,
        memo = memo, createdAt = createdAt, updatedAt = updatedAt,
    )

    private fun SavedStayEntity.toDomain() = SavedStay.reconstitute(
        savedStayId = savedStayId, accountId = accountId, name = name, lat = lat, lng = lng,
        coordConfirmed = coordConfirmed, checkIn = checkIn, checkOut = checkOut,
        externalSource = externalSource, externalId = externalId,
        registerRoute = RegisterRoute.valueOf(registerRoute),
        memo = memo, createdAt = createdAt, updatedAt = updatedAt,
    )

    private companion object {
        /** V2.57 의 유니크 인덱스 — 계정당 같은 외부 숙소 1건(TRIP-1059). */
        const val EXTERNAL_UNIQUE = "ux_saved_stay_external"
    }
}

/**
 * 위반한 제약이 [constraint] 인가. **드라이버가 서버에서 받은 구조화 필드**(`ServerErrorMessage.constraint`)를 먼저 본다 —
 * 서버 문구 언어(`lc_messages`)와 무관하다. Hibernate 의 `constraintName` 은 방언이 오류 **문구**에서 뽑을 수 있는 값이라
 * 문구가 영어가 아니면 비어, 진짜 경합이 500 으로 나갈 수 있다. 그래서 드라이버 필드가 없을 때의 보조로만 쓴다.
 */
internal fun DataIntegrityViolationException.violatesConstraint(constraint: String): Boolean {
    val chain = generateSequence<Throwable>(this) { it.cause }.toList()
    val fromServer = chain.filterIsInstance<PSQLException>().firstNotNullOfOrNull { it.serverErrorMessage?.constraint }
    val name = fromServer ?: chain.filterIsInstance<ConstraintViolationException>().firstNotNullOfOrNull { it.constraintName }
    return name.equals(constraint, ignoreCase = true)
}
