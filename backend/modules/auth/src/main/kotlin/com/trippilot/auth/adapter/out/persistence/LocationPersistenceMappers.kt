package com.trippilot.auth.adapter.out.persistence

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.location.LocationConsent
import com.trippilot.auth.domain.location.OsPermission

/** location 영속 ↔ 도메인 매핑. legal_log 는 append 전용이라 도메인→엔티티(직렬화)만 필요. */

fun LocationConsentStateJpaEntity.toDomain(): LocationConsent =
    LocationConsent.reconstitute(
        AccountId(accountId),
        OsPermission.valueOf(osPermissionMirror),
        legalConsent,
        gpsRecordingOptIn,
        updatedAt,
    )

fun LocationConsent.toEntity(): LocationConsentStateJpaEntity =
    LocationConsentStateJpaEntity(accountId.value, osPermission.name, legalConsent, gpsRecordingOptIn, updatedAt)
