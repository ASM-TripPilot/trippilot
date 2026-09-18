package com.trippilot.auth.adapter.out.persistence

import org.springframework.data.jpa.repository.JpaRepository
import java.util.UUID

/** location_consent_state — 계정당 1행 upsert. */
interface LocationConsentStateJpaRepository : JpaRepository<LocationConsentStateJpaEntity, UUID>

/** location_legal_log — append-only. INSERT 는 JpaRepository.save. */
interface LocationLegalLogJpaRepository : JpaRepository<LocationLegalLogJpaEntity, Long>
