package com.trippilot.profile.adapter.out.persistence

import com.trippilot.profile.domain.AccountSetting
import com.trippilot.profile.domain.AccountSettingKey
import com.trippilot.profile.domain.AccountSettingRepository
import jakarta.persistence.Column
import jakarta.persistence.Embeddable
import jakarta.persistence.EmbeddedId
import jakarta.persistence.Entity
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component
import java.io.Serializable
import java.time.Clock
import java.time.Instant
import java.util.UUID

/**
 * `account_setting`(V2.42) 매핑 — 계정+키 복합 PK.
 *
 * ID 클래스는 `data class` 다(엔티티는 일반 class) — 복합 키는 값 동등성이 필요하고,
 * 엔티티는 전 필드 비교가 컬렉션 멤버십을 깨뜨린다.
 */
@Embeddable
data class AccountSettingId(
    @Column(name = "account_id") var accountId: UUID = UUID(0, 0),
    @Column(name = "key") var key: String = "",
) : Serializable

@Entity
@Table(name = "account_setting")
class AccountSettingJpaEntity(
    @EmbeddedId var id: AccountSettingId,
    @Column(name = "value") var value: String,
    @Column(name = "updated_at") var updatedAt: Instant,
)

interface AccountSettingJpaRepository : JpaRepository<AccountSettingJpaEntity, AccountSettingId> {
    fun findByIdAccountId(accountId: UUID): List<AccountSettingJpaEntity>
}

@Component
class AccountSettingRepositoryAdapter(
    private val jpa: AccountSettingJpaRepository,
    private val clock: Clock,
) : AccountSettingRepository {

    /**
     * 저장된 키가 어휘를 벗어나면 **버린다**(지어내지 않는다). 옛 키가 남아 있어도 화면이 그것을
     * 모르는 설정으로 그리지 않게 한다 — 어휘의 주인은 서버다.
     */
    override fun findAll(accountId: UUID): List<AccountSetting> =
        jpa.findByIdAccountId(accountId).mapNotNull { e ->
            AccountSettingKey.of(e.id.key)?.let { AccountSetting(accountId, it, e.value, e.updatedAt) }
        }

    override fun upsert(setting: AccountSetting): AccountSetting {
        val now = clock.instant()
        jpa.save(
            AccountSettingJpaEntity(
                AccountSettingId(setting.accountId, setting.key.storageKey),
                setting.value,
                now,
            ),
        )
        return setting.copy(updatedAt = now)
    }
}
