package com.trippilot.auth.adapter.out.persistence

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.location.LocationConsent
import com.trippilot.auth.domain.location.LocationLegalEvent
import com.trippilot.auth.domain.port.LocationConsentStateRepository
import com.trippilot.auth.domain.port.LocationLegalLogRepository
import org.springframework.stereotype.Repository

/** LocationConsentStateRepository 포트의 JPA 구현(계정당 1행 upsert). */
@Repository
class JpaLocationConsentStateRepository(
    private val jpa: LocationConsentStateJpaRepository,
) : LocationConsentStateRepository {
    override fun find(accountId: AccountId): LocationConsent? =
        jpa.findById(accountId.value).orElse(null)?.toDomain()

    override fun save(state: LocationConsent): LocationConsent {
        jpa.save(state.toEntity())
        return state
    }
}

/** LocationLegalLogRepository 포트의 JPA 구현 — append-only(INV-LL1). detail 맵을 jsonb 문자열로 직렬화. */
@Repository
class JpaLocationLegalLogRepository(
    private val jpa: LocationLegalLogJpaRepository,
) : LocationLegalLogRepository {
    private val objectMapper = ObjectMapper()

    override fun append(event: LocationLegalEvent) {
        val detailJson = objectMapper.writeValueAsString(event.detail)
        jpa.save(
            LocationLegalLogJpaEntity(
                accountId = event.accountId.value,
                eventType = event.eventType.name,
                detail = detailJson,
                occurredAt = event.occurredAt,
            ),
        )
    }
}
