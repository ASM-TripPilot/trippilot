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
 * `[]`·스칼라 행은 Hibernate 가 엔티티를 적재하는 순간 역직렬화에 실패하고(어댑터에 닿기 전), jsonb `null` 은 Jackson 이
 * null 로 읽어 비-null 필드에 null 이 든 채 어댑터에서 NPE 가 난다. 어느 쪽이든 그 여행의 타임라인이 500 이 된다(TRIP-1476 H).
 * 빈 객체에는 `days` 가 없으므로 아래 [ChangeLogRepositoryAdapter] 가 그 행을 건너뛴다.
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
     * 이력 행은 **전부 읽히거나, 통째로 건너뛴다**(TRIP-1476 B·E·H) — 반쯤 읽어 돌려주지 않는다.
     * - 모르는 출처: V2.11 CHECK 가 막으므로 enum 값을 지우거나 바꾼 뒤 남은 옛 행, 또는 CHECK 에 새 값을 더한 뒤 앱을 이전 판으로 되돌렸을 때 생긴다. `valueOf` 로 던지면
     *   그 한 행이 여행 타임라인 전체를 영구히 500 으로 만들고, 아는 값으로 지어내면 "누가 바꿨나"를 틀리게 보여 준다.
     * - 스냅숏 일부를 못 읽음: 한쪽 스냅숏의 날·슬롯만 버리고 돌려주면 소비자가 **없던 변경을 본다** — 재계획
     *   (`ReplanFacadeService.changesOn`)은 `before − after` 로 못 읽은 슬롯·날을 "그날 뺀 곳"으로 계산해 AI 에 싣고,
     *   REST 응답·아카이브 합본에도 그 반쪽 스냅숏이 그대로 실린다. 그래서 한 조각이라도 못 읽으면 그 행은 없는 것으로 친다.
     * 건너뛴 행은 WARN 으로 남긴다 — 조용히 빠지면 "이력이 왜 비나"를 못 찾는다(INV-4).
     */
    private fun ChangeLogEntryEntity.toDomain(): ChangeLogEntry? {
        val source = ChangeSource.entries.find { it.name == sourceType } ?: run {
            log.warn("모르는 변경 출처라 이력 행을 건너뜁니다. changeLogEntryId={} sourceType={}", changeLogEntryId, sourceType)
            return null
        }
        val before = beforeSnapshot.toSnapshot()
        val after = afterSnapshot.toSnapshot()
        if (before == null || after == null) {
            log.warn(
                "스냅숏을 읽지 못해 이력 행을 건너뜁니다. changeLogEntryId={} beforeReadable={} afterReadable={}",
                changeLogEntryId, before != null, after != null,
            )
            return null
        }
        return ChangeLogEntry(
            entryId = changeLogEntryId,
            tripId = tripId,
            actor = actor,
            source = source,
            reason = reason,
            before = before,
            after = after,
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
     * jsonb → 스냅숏. 못 읽는 조각이 하나라도 있으면 **null**(그 행을 건너뛴다 — [toDomain]).
     * 저장([toMap])은 V2.11 첫 판부터 모든 키(`days`·`date`·`slots`·`poiId`·`startAt`·`endAt`·`isFixed`·`endsNextDay`)를
     * 늘 썼다 — 슬롯이 없는 생성 이력도 `{"days":[]}` 이고, 그것은 정상으로 읽힌다. 그러니 키가 없거나 모양이 다르면
     * 저장 계약 밖에서 들어온 행이고, 기본값으로 메워 읽을 근거가 없다.
     * 리스트 원소도 하나씩 본다 — `as? List<Map<..>>` 는 타입 소거로 "리스트인가"만 보고, 원소가 객체가 아니면
     * 그 원소를 Map 으로 쓰는 순간 ClassCastException 이 난다(TRIP-1476 B).
     * 스냅숏에 키가 늘면 옛 행에는 그 키가 없다 — 그때는 이 자리에서 그 키만 기본값을 정한다(지금은 없다).
     */
    private fun Map<String, Any>.toSnapshot(): ItinerarySnapshot? {
        val days = this["days"] as? List<*> ?: return null
        return ItinerarySnapshot(days.map { d -> (d as? Map<*, *>)?.toDay() ?: return null })
    }

    private fun Map<*, *>.toDay(): DaySnapshot? {
        val date = (this["date"] as? String)?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: return null
        val slots = this["slots"] as? List<*> ?: return null
        return DaySnapshot(date, slots.map { s -> (s as? Map<*, *>)?.toSlot() ?: return null })
    }

    private fun Map<*, *>.toSlot(): SlotSnapshot? {
        val poiId = (this["poiId"] as? String)?.let { runCatching { UUID.fromString(it) }.getOrNull() } ?: return null
        val startAt = (this["startAt"] as? String)?.let { runCatching { LocalTime.parse(it) }.getOrNull() } ?: return null
        val endAt = (this["endAt"] as? String)?.let { runCatching { LocalTime.parse(it) }.getOrNull() } ?: return null
        val isFixed = this["isFixed"] as? Boolean ?: return null
        val endsNextDay = this["endsNextDay"] as? Boolean ?: return null
        return SlotSnapshot(poiId, startAt, endAt, isFixed, endsNextDay)
    }

    private companion object {
        private val log = LoggerFactory.getLogger(ChangeLogRepositoryAdapter::class.java)
    }
}
