package com.trippilot.auth.adapter.out.persistence

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import java.util.UUID

/** location_consent_state — 계정당 1행 upsert. */
interface LocationConsentStateJpaRepository : JpaRepository<LocationConsentStateJpaEntity, UUID>

/** location_legal_log — append-only. INSERT 는 JpaRepository.save. */
interface LocationLegalLogJpaRepository : JpaRepository<LocationLegalLogJpaEntity, Long> {
    /** V2.49 정의자 함수 실행 — app_user 는 EXECUTE 만 갖는다(직접 DELETE 는 여전히 권한 거부). */
    @Query(value = "SELECT purge_expired_location_legal_log()", nativeQuery = true)
    fun purgeExpired(): Int
}
