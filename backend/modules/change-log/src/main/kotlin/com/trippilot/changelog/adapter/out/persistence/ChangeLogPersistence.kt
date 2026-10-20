package com.trippilot.changelog.adapter.out.persistence

import com.trippilot.changelog.domain.ChangeLogEntry
import com.trippilot.changelog.domain.ChangeLogRepository
import com.trippilot.changelog.domain.ChangeSource
import com.trippilot.changelog.domain.DaySnapshot
import com.trippilot.changelog.domain.ItinerarySnapshot
import com.trippilot.changelog.domain.SlotSnapshot
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.ColumnTransformer
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.slf4j.LoggerFactory
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
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
 *
 * 스냅숏 컬럼은 **최상위가 객체일 때만** 그대로 읽고, 아니면(`[]`·스칼라·jsonb `null`) 빈 객체로 읽는다 — 필드가 `Map` 이라
 * 그런 행은 Hibernate 가 엔티티를 적재하는 순간 역직렬화에 실패하고, 어댑터의 방어적 읽기에 닿기도 전에 그 여행의
 * 타임라인이 500 이 된다(TRIP-1476 H). 빈 객체는 아래 [ChangeLogRepositoryAdapter] 가 빈 스냅숏으로 읽는다.
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
    @ColumnTransformer(read = "CASE WHEN jsonb_typeof(before_snapshot) = 'object' THEN before_snapshot ELSE jsonb_build_object() END")
    @Column(name = "before_snapshot") var beforeSnapshot: Map<String, Any>,
    @JdbcTypeCode(SqlTypes.JSON)
    @ColumnTransformer(read = "CASE WHEN jsonb_typeof(after_snapshot) = 'object' THEN after_snapshot ELSE jsonb_build_object() END")
    @Column(name = "after_snapshot") var afterSnapshot: Map<String, Any>,
    @Column(name = "at") var at: Instant,
)

interface ChangeLogJpaRepository : JpaRepository<ChangeLogEntryEntity, Long> {
    // at 동률은 IDENTITY 로 갈라 순서를 결정론적으로 — 같은 초에 여러 건이 쌓일 수 있다.
    fun findByTripIdOrderByAtDescChangeLogEntryIdDesc(tripId: UUID, pageable: Pageable): List<ChangeLogEntryEntity>
}

@Component
class ChangeLogRepositoryAdapter(private val jpa: ChangeLogJpaRepository) : ChangeLogRepository {

    override fun append(entry: ChangeLogEntry): ChangeLogEntry {
        val saved = jpa.save(
            ChangeLogEntryEntity(
                changeLogEntryId = null,
                tripId = entry.tripId,
                actor = entry.actor,
                sourceType = entry.source.name,
                reason = entry.reason,
                beforeSnapshot = entry.before.toMap(),
                afterSnapshot = entry.after.toMap(),
                at = entry.at,
            ),
        )
        return entry.copy(entryId = saved.changeLogEntryId)
    }

    override fun findByTrip(tripId: UUID, limit: Int): List<ChangeLogEntry> =
        jpa.findByTripIdOrderByAtDescChangeLogEntryIdDesc(tripId, PageRequest.of(0, limit)).mapNotNull { it.toDomain() }

    /**
     * 모르는 출처의 행은 **그 행만** 버린다(TRIP-1476 E) — V2.11 CHECK 가 막으므로 enum 값을 지우거나 바꾼 뒤 남은
     * 옛 행에서만 생긴다. `valueOf` 로 던지면 그 한 행이 여행 타임라인 전체를 영구히 500 으로 만든다.
     * 출처를 지어내 읽지 않는 이유: 모르는 값을 아는 값으로 바꾸면 "누가 바꿨나"를 틀리게 보여 준다.
     */
    private fun ChangeLogEntryEntity.toDomain(): ChangeLogEntry? {
        val source = ChangeSource.entries.find { it.name == sourceType } ?: run {
            log.warn("모르는 변경 출처라 이력 행을 건너뜁니다. changeLogEntryId={} sourceType={}", changeLogEntryId, sourceType)
            return null
        }
        return ChangeLogEntry(
            entryId = changeLogEntryId,
            tripId = tripId,
            actor = actor,
            source = source,
            reason = reason,
            before = beforeSnapshot.toSnapshot(),
            after = afterSnapshot.toSnapshot(),
            at = at,
        )
    }

    // ---- 스냅숏 ↔ jsonb(Map) 변환. 저장 형식이 계약이라 필드명을 여기서 고정한다.
    private fun ItinerarySnapshot.toMap(): Map<String, Any> = mapOf(
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

    /**
     * jsonb → 스냅숏. **읽기는 전부 방어적으로** 한다 — 이력은 append-only 라 한 번 저장된 행은 고칠 수 없고,
     * 스냅숏 형태가 나중에 바뀌면(슬롯에 endsNextDay 가 V2.8 에서 늘었듯) 옛 행에 없는 필드를 단정 캐스팅하는 순간
     * 그 여행의 타임라인이 **영구히 500** 이 된다. 못 읽는 조각은 버리고 읽히는 만큼 돌려준다.
     * 리스트 원소도 하나씩 거른다 — `as? List<Map<..>>` 는 타입 소거로 "리스트인가"만 보고, 원소가 객체가 아니면
     * 그 원소를 Map 으로 쓰는 순간 ClassCastException 이 난다(TRIP-1476 B).
     */
    private fun Map<String, Any>.toSnapshot(): ItinerarySnapshot {
        val days = (this["days"] as? List<*>).orEmpty().filterIsInstance<Map<*, *>>().mapNotNull { d ->
            val date = (d["date"] as? String)?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: return@mapNotNull null
            DaySnapshot(
                date = date,
                slots = (d["slots"] as? List<*>).orEmpty().filterIsInstance<Map<*, *>>().mapNotNull { s -> s.toSlot() },
            )
        }
        return ItinerarySnapshot(days)
    }

    private fun Map<*, *>.toSlot(): SlotSnapshot? {
        val poiId = (this["poiId"] as? String)?.let { runCatching { UUID.fromString(it) }.getOrNull() } ?: return null
        val startAt = (this["startAt"] as? String)?.let { runCatching { LocalTime.parse(it) }.getOrNull() } ?: return null
        val endAt = (this["endAt"] as? String)?.let { runCatching { LocalTime.parse(it) }.getOrNull() } ?: return null
        return SlotSnapshot(poiId, startAt, endAt, this["isFixed"] as? Boolean ?: false, this["endsNextDay"] as? Boolean ?: false)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(ChangeLogRepositoryAdapter::class.java)
    }
}
