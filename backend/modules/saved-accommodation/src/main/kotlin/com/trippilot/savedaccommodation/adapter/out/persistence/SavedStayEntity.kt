package com.trippilot.savedaccommodation.adapter.out.persistence

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** saved_stay(V2.2) 매핑. register_route 는 문자열(enum name). */
@Entity
@Table(name = "saved_stay")
class SavedStayEntity(
    @Id @Column(name = "saved_stay_id") var savedStayId: UUID,
    @Column(name = "account_id") var accountId: UUID,
    @Column(name = "name") var name: String,
    @Column(name = "lat") var lat: Double?,
    @Column(name = "lng") var lng: Double?,
    @Column(name = "coord_confirmed") var coordConfirmed: Boolean,
    @Column(name = "check_in") var checkIn: LocalDate?,
    @Column(name = "check_out") var checkOut: LocalDate?,
    @Column(name = "external_source") var externalSource: String?,
    @Column(name = "external_id") var externalId: String?,
    @Column(name = "register_route") var registerRoute: String,
    @Column(name = "memo") var memo: String?,
    @Column(name = "created_at") var createdAt: Instant,
    @Column(name = "updated_at") var updatedAt: Instant,
)
