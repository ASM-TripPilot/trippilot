package com.trippilot.moderation.adapter.out.persistence

import com.trippilot.moderation.domain.BannedWord
import com.trippilot.moderation.domain.BannedWordDictionary
import com.trippilot.moderation.domain.BannedWordDictionaryRepository
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository
import java.time.Instant

/**
 * banned_word_dictionary 매핑(V1.6). entries 는 jsonb [{word,category}].
 * Map 리스트로 매핑 — Hibernate FormatMapper 로 도메인 타입 직접 역직렬화는 설정 의존이라 회피
 * (location_legal_log 와 동일 방식). 도메인 [BannedWord] 변환은 포트 구현에서 방어적으로 수행.
 */
@Entity
@Table(name = "banned_word_dictionary")
class BannedWordDictionaryJpaEntity(
    @Id
    @Column(name = "dict_version")
    var dictVersion: String,

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "entries")
    var entries: List<Map<String, String>>,

    @Column(name = "deployed_at")
    var deployedAt: Instant,

    @Column(name = "active")
    var active: Boolean,
)

interface BannedWordDictionaryJpaRepository : JpaRepository<BannedWordDictionaryJpaEntity, String> {
    fun findFirstByActiveTrue(): BannedWordDictionaryJpaEntity?
}

/** BannedWordDictionaryRepository 포트의 JPA 구현. */
@Repository
class JpaBannedWordDictionaryRepository(
    private val jpa: BannedWordDictionaryJpaRepository,
) : BannedWordDictionaryRepository {
    override fun findActive(): BannedWordDictionary? =
        jpa.findFirstByActiveTrue()?.let { entity ->
            BannedWordDictionary(
                version = entity.dictVersion,
                // 방어적 매핑 — word 누락/공백 항목은 스킵(매칭 불가), category 누락은 UNKNOWN.
                // 손상 항목이 500(NoSuchElementException) 나지 않게 한다.
                entries = entity.entries.mapNotNull { row ->
                    val word = row["word"]?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                    BannedWord(word, row["category"] ?: "UNKNOWN")
                },
                active = entity.active,
            )
        }
}
