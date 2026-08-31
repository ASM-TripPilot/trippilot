package com.trippilot.profile.domain

import java.util.UUID

/** 계정 설정 저장소. 키가 없으면 **없는 것**이고 기본값 판단은 읽는 쪽이 한다. */
interface AccountSettingRepository {
    fun findAll(accountId: UUID): List<AccountSetting>

    /** 있으면 값을 바꾸고 없으면 만든다(계정+키 복합 PK). */
    fun upsert(setting: AccountSetting): AccountSetting
}
