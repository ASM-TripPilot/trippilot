package com.trippilot.trip.adapter.out.persistence

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** trip(V2.3). preference_snapshot 은 jsonb ↔ Map(도메인 타입 매핑, 수동 직렬화 금지). */
@Entity
@Table(name = "trip")
class TripEntity(
    @Id @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "account_id") var accountId: UUID,
    @Column(name = "title") var title: String,
    @Column(name = "start_date") var startDate: LocalDate,
    @Column(name = "end_date") var endDate: LocalDate,
    @Column(name = "party") var party: Int,
    @Column(name = "companion_type") var companionType: String?,
    @Column(name = "budget_total") var budgetTotal: Long?,
    @JdbcTypeCode(SqlTypes.JSON) @Column(name = "preference_snapshot") var preferenceSnapshot: MutableMap<String, Any?>,
    @Column(name = "status") var status: String,
    @Column(name = "deleted_at") var deletedAt: Instant?,
    @Column(name = "ended_at") var endedAt: Instant? = null,
    @Column(name = "created_at") var createdAt: Instant,
    @Column(name = "updated_at") var updatedAt: Instant,
)

/** trip_destination(V2.3). 다도시 목적지·박수. */
@Entity
@Table(name = "trip_destination")
class TripDestinationEntity(
    @Id @Column(name = "trip_destination_id") var tripDestinationId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "seq") var seq: Int,
    @Column(name = "region") var region: String,
    @Column(name = "nights") var nights: Int,
)
