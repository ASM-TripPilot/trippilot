package com.trippilot.itinerarygeneration.adapter.out.persistence

import com.trippilot.itinerarygeneration.domain.DaySnapshot
import com.trippilot.itinerarygeneration.domain.ItineraryRevision
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionRepository
import com.trippilot.itinerarygeneration.domain.ItinerarySnapshot
import com.trippilot.itinerarygeneration.domain.NewRevision
import com.trippilot.itinerarygeneration.domain.RevisionActor
import com.trippilot.itinerarygeneration.domain.RevisionKind
import com.trippilot.itinerarygeneration.domain.SlotSnapshot
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** itinerary_revision 매핑(V2.14). app_user 는 UPDATE/DELETE 권한 없음 — 되돌리기는 새 행을 쌓는다. */
@Entity
@Table(name = "itinerary_revision")
class ItineraryRevisionEntity(
    @Id @Column(name = "revision_id") var revisionId: UUID,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "itinerary_id") var itineraryId: UUID,
    @Column(name = "seq") var seq: Int,
    @Column(name = "actor") var actor: String,
    @Column(name = "kind") var kind: String,
    @Column(name = "summary") var summary: String,
    @Column(name = "detail") var detail: String?,
    // 스냅숏은 Map 으로 jsonb 매핑 — 문자열을 미리 직렬화해 넘기면 이중 인코딩된다.
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "snapshot") var snapshot: Map<String, Any>,
    @Column(name = "created_at") var createdAt: Instant,
)

interface ItineraryRevisionJpaRepository : JpaRepository<ItineraryRevisionEntity, UUID> {
    fun findByTripIdOrderBySeqDesc(tripId: UUID): List<ItineraryRevisionEntity>
    fun findFirstByTripIdOrderBySeqDesc(tripId: UUID): ItineraryRevisionEntity?
}

@Component
class ItineraryRevisionRepositoryAdapter(
    private val jpa: ItineraryRevisionJpaRepository,
) : ItineraryRevisionRepository {

    /**
     * seq = 현재 최대+1. 동시 기록이 같은 seq 를 집으면 UNIQUE 제약(ux_itinerary_revision_seq)이 막는다 —
     * 앱에서 몰래 덮어쓰는 것보다 실패로 드러나는 편이 낫다(INV-U3-06).
     */
    @Transactional
    override fun append(revision: NewRevision): ItineraryRevision {
        val nextSeq = (jpa.findFirstByTripIdOrderBySeqDesc(revision.tripId)?.seq ?: 0) + 1
        val entity = ItineraryRevisionEntity(
            revisionId = UUID.randomUUID(),
            tripId = revision.tripId,
            itineraryId = revision.itineraryId,
            seq = nextSeq,
            actor = revision.actor.name,
            kind = revision.kind.name,
            summary = revision.summary,
            detail = revision.detail,
            snapshot = revision.snapshot.toMap(),
            createdAt = revision.createdAt,
        )
        return jpa.save(entity).toDomain()
    }

    override fun findByTrip(tripId: UUID): List<ItineraryRevision> =
        jpa.findByTripIdOrderBySeqDesc(tripId).map { it.toDomain() }

    override fun findById(revisionId: UUID): ItineraryRevision? =
        jpa.findById(revisionId).orElse(null)?.toDomain()

    private fun ItineraryRevisionEntity.toDomain() = ItineraryRevision(
        revisionId, tripId, itineraryId, seq, RevisionActor.valueOf(actor), RevisionKind.valueOf(kind),
        summary, detail, snapshot.toSnapshot(), createdAt,
    )

    // ---- 스냅숏 ↔ jsonb(Map). 저장 형식이 계약이라 필드명을 여기서 고정한다.
    private fun ItinerarySnapshot.toMap(): Map<String, Any> = mapOf(
        "days" to days.map { d ->
            mapOf(
                "date" to d.date.toString(),
                "slots" to d.slots.map { s ->
                    buildMap {
                        put("poiId", s.poiId.toString())
                        put("startAt", s.startAt.toString())
                        put("endAt", s.endAt.toString())
                        put("isFixed", s.isFixed)
                        put("endsNextDay", s.endsNextDay)
                        s.distanceRange?.let { put("distanceRange", it) }
                        s.placementReason?.let { put("placementReason", it) }
                    }
                },
            )
        },
    )

    /**
     * 읽기는 **전부 방어적으로** — 이력은 지울 수 없고, 스냅숏 형태가 나중에 늘면 옛 행의 단정 캐스팅이
     * 그 일정의 이력 조회를 영구히 500 으로 만든다(change-log 에서 같은 지적을 받았다).
     */
    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any>.toSnapshot(): ItinerarySnapshot {
        val days = (this["days"] as? List<Map<String, Any>>).orEmpty().mapNotNull { d ->
            val date = (d["date"] as? String)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
                ?: return@mapNotNull null
            DaySnapshot(date, (d["slots"] as? List<Map<String, Any>>).orEmpty().mapNotNull { it.toSlot() })
        }
        return ItinerarySnapshot(days)
    }

    private fun Map<String, Any>.toSlot(): SlotSnapshot? {
        val poiId = (this["poiId"] as? String)?.let { runCatching { UUID.fromString(it) }.getOrNull() } ?: return null
        val startAt = (this["startAt"] as? String)?.let { runCatching { LocalTime.parse(it) }.getOrNull() } ?: return null
        val endAt = (this["endAt"] as? String)?.let { runCatching { LocalTime.parse(it) }.getOrNull() } ?: return null
        return SlotSnapshot(
            poiId, startAt, endAt,
            this["isFixed"] as? Boolean ?: false,
            this["endsNextDay"] as? Boolean ?: false,
            this["distanceRange"] as? String,
            this["placementReason"] as? String,
        )
    }
}
