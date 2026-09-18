package com.trippilot.accommodationsearch.adapter.out.persistence

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.IdClass
import jakarta.persistence.Table
import java.io.Serializable
import java.time.Instant

/** stay_price_snapshot(V2.1) 매핑. 복합 PK (external_source, external_id). */
@Entity
@Table(name = "stay_price_snapshot")
@IdClass(StayPriceSnapshotId::class)
class StayPriceSnapshotEntity(
    @Id @Column(name = "external_source") var externalSource: String,
    @Id @Column(name = "external_id") var externalId: String,
    @Column(name = "lowest_amount") var lowestAmount: Long?,
    @Column(name = "currency") var currency: String,
    @Column(name = "captured_at") var capturedAt: Instant,
)

/** 복합 PK 식별자. */
data class StayPriceSnapshotId(
    var externalSource: String = "",
    var externalId: String = "",
) : Serializable
