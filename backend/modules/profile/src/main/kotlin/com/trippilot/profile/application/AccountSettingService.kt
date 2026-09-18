package com.trippilot.profile.application

import com.trippilot.profile.domain.AccountSetting
import com.trippilot.profile.domain.AccountSettingKey
import com.trippilot.profile.domain.AccountSettingRepository
import com.trippilot.profile.domain.BooleanSetting
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

/** 계정 설정 한 벌. 저장된 것이 없으면 **기본값**이지 오류가 아니다. */
data class AccountSettingsView(val affiliateNoticeDismissed: Boolean)

/**
 * 계정 단위 앱 설정(BR-U6-33).
 *
 * ## 없는 값은 기본값이다
 *
 * 한 번도 저장한 적 없는 계정은 행이 없다. 그것을 404 로 다루면 화면이 첫 진입에서 설정을 못 그린다 —
 * 없으면 "아직 끄지 않았다"(false)가 사실이다.
 *
 * ## PATCH 는 **준 것만** 바꾼다
 *
 * 필드를 생략하면 그대로 둔다(`UpdateToggleRequest` 와 같은 규약). null 을 "false 로 바꿔라"로 읽으면
 * 화면이 한 토글을 만질 때 다른 토글이 조용히 꺼진다.
 */
@Service
class AccountSettingService(private val settings: AccountSettingRepository) {

    @Transactional(readOnly = true)
    fun of(accountId: UUID): AccountSettingsView = view(settings.findAll(accountId))

    @Transactional
    fun patch(accountId: UUID, affiliateNoticeDismissed: Boolean?): AccountSettingsView {
        affiliateNoticeDismissed?.let {
            settings.upsert(
                AccountSetting(
                    accountId = accountId,
                    key = AccountSettingKey.AFFILIATE_NOTICE_DISMISSED,
                    value = BooleanSetting.write(it),
                    updatedAt = Instant.EPOCH, // 저장 시각은 저장소가 찍는다
                ),
            )
        }
        return of(accountId)
    }

    private fun view(stored: List<AccountSetting>): AccountSettingsView {
        val byKey = stored.associate { it.key to it.value }
        return AccountSettingsView(
            affiliateNoticeDismissed = BooleanSetting.read(byKey[AccountSettingKey.AFFILIATE_NOTICE_DISMISSED]),
        )
    }
}
