package com.trippilot.auth.adapter.out.persistence

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

/** social_identity 테이블 매핑(V1.1). (provider, provider_sub) 유니크. */
@Entity
@Table(name = "social_identity")
class SocialIdentityJpaEntity(
    @Id
    @Column(name = "social_identity_id")
    var socialIdentityId: UUID,

    @Column(name = "account_id")
    var accountId: UUID,

    @Column(name = "provider")
    var provider: String,

    @Column(name = "provider_sub")
    var providerSub: String,

    @Column(name = "provider_email")
    var providerEmail: String?,

    @Column(name = "linked_at")
    var linkedAt: Instant,
)
