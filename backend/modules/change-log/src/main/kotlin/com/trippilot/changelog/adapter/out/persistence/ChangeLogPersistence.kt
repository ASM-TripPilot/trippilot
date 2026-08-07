package com.trippilot.changelog.adapter.out.persistence

import com.trippilot.changelog.api.ChangeSourceType
import com.trippilot.changelog.api.DaySnapshotView
import com.trippilot.changelog.api.ItinerarySnapshotView
import com.trippilot.changelog.api.SlotSnapshotView
import com.trippilot.changelog.domain.ChangeLogEntry
import com.trippilot.changelog.domain.ChangeLogRepository
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * change_log_entry 매핑(V2.11). app_user 는 UPDATE/DELETE 권한 없음(append-only).
 * 스냅숏은 Map 으로 jsonb 매핑한다 — 문자열을 미리 직렬화해 넘기면 이중 인코딩되어
 * jsonb 에 이스케이프된 스칼라가 저장된다(location_legal_log 에서 겪은 것과 같은 함정).
 */
@Entity
@Table(name = "change_log_entry")
class ChangeLogEntryEntity(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "change_log_entry_id") var changeLogEntryId: Long? = null,
    @Column(name = "trip_id") var tripId: UUID,
    @Column(name = "actor") var actor: String,
    @Column(name = "source_type") var sourceType: String,
    @Column(name = "reason") var reason: String?,
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "before_snapshot") var beforeSnapshot: Map<String, Any>,
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "after_snapshot") var afterSnapshot: Map<String, Any>,
    @Column(name = "at") var at: Instant,
)

interface ChangeLogJpaRepository : JpaRepository<ChangeLogEntryEntity, Long> {
    fun findByTripIdOrderByAtDescChangeLogEntryIdDesc(tripId: UUID): List<ChangeLogEntryEntity>
}

@Component
class ChangeLogRepositoryAdapter(private val jpa: ChangeLogJpaRepository) : ChangeLogRepository {

    override fun append(entry: ChangeLogEntry): ChangeLogEntry {
        val saved = jpa.save(
            ChangeLogEntryEntity(
                changeLogEntryId = null,
                tripId = entry.tripId,
                actor = entry.actor,
                sourceType = entry.sourceType.name,
                reason = entry.reason,
                beforeSnapshot = entry.before.toMap(),
                afterSnapshot = entry.after.toMap(),
                at = entry.at,
            ),
        )
        return entry.copy(entryId = saved.changeLogEntryId)
    }

    override fun findByTrip(tripId: UUID): List<ChangeLogEntry> =
        jpa.findByTripIdOrderByAtDescChangeLogEntryIdDesc(tripId).map { it.toDomain() }

    private fun ChangeLogEntryEntity.toDomain() = ChangeLogEntry(
        entryId = changeLogEntryId,
        tripId = tripId,
        actor = actor,
        sourceType = ChangeSourceType.valueOf(sourceType),
        reason = reason,
        before = beforeSnapshot.toSnapshot(),
        after = afterSnapshot.toSnapshot(),
        at = at,
    )

    // ---- 스냅숏 ↔ jsonb(Map) 변환. 구조가 계약이라 필드명을 여기서 고정한다.
    private fun ItinerarySnapshotView.toMap(): Map<String, Any> = mapOf(
        "days" to days.map { d ->
            mapOf(
                "date" to d.date.toString(),
                "slots" to d.slots.map { s ->
                    mapOf(
                        "poiId" to s.poiId.toString(),
                        "startAt" to s.startAt.toString(),
                        "endAt" to s.endAt.toString(),
                        "isFixed" to s.isFixed,
                        "endsNextDay" to s.endsNextDay,
                    )
                },
            )
        },
    )

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any>.toSnapshot(): ItinerarySnapshotView {
        val days = (this["days"] as? List<Map<String, Any>>).orEmpty().map { d ->
            DaySnapshotView(
                date = LocalDate.parse(d["date"] as String),
                slots = (d["slots"] as? List<Map<String, Any>>).orEmpty().map { s ->
                    SlotSnapshotView(
                        poiId = UUID.fromString(s["poiId"] as String),
                        startAt = LocalTime.parse(s["startAt"] as String),
                        endAt = LocalTime.parse(s["endAt"] as String),
                        isFixed = s["isFixed"] as Boolean,
                        endsNextDay = s["endsNextDay"] as Boolean,
                    )
                },
            )
        }
        return ItinerarySnapshotView(days)
    }
}
