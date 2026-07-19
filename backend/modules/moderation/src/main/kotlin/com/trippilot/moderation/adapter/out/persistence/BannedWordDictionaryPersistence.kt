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
 * Map 리스트로 매핑(도메인 타입 직접 역직렬화 회피 — Hibernate 기본 FormatMapper 는 kotlin 모듈 미탑재).
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
                entries = entity.entries.map { BannedWord(it.getValue("word"), it.getValue("category")) },
                active = entity.active,
            )
        }
}
