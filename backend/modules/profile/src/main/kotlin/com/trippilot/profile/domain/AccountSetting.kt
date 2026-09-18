package com.trippilot.profile.domain

import java.time.Instant
import java.util.UUID

/**
 * 계정 단위 앱 설정 한 칸(BR-U6-33 · DEC-U6-7a).
 *
 * ## 취향과 다른 자리인 이유
 *
 * 취향([PreferenceSet])은 여행 생성 시 `preferenceSnapshot` 으로 **동결**된다. 앱 설정을 거기 섞으면
 * "제휴 안내를 다시 안 보기" 같은 값이 여행 이력에 박힌다 — 성질이 다르다. 설정은 지금의 상태이고
 * 취향은 그때의 선택이다.
 *
 * ## 기기 로컬이 아니다
 *
 * `l05` 가 이 값을 **설정 화면의 토글**로 그린다. 설정에 있는 값이 기기마다 다르면 사용자 모델이
 * 깨진다(DEC-U6-7a — 계획서는 기기 로컬을 권했으나 실물 확인으로 뒤집혔다).
 */
data class AccountSetting(
    val accountId: UUID,
    val key: AccountSettingKey,
    val value: String,
    val updatedAt: Instant,
)

/**
 * 설정 키 어휘 — **주인은 서버 하나다.**
 *
 * DB 에 CHECK 를 걸지 않는다(`notification_toggle.kind` 와 같은 이유) — 설정이 하나 늘 때마다
 * 마이그레이션이 붙으면 key-value 로 둔 뜻이 사라진다. 대신 여기서 어휘를 닫고, 모르는 키는
 * 저장도 조회도 되지 않는다.
 */
enum class AccountSettingKey(val storageKey: String) {
    /** 외부 이동 시 제휴 안내를 다시 보지 않는다(BR-U6-33). `l05` 토글로 되돌릴 수 있다. */
    AFFILIATE_NOTICE_DISMISSED("affiliateNoticeDismissed"),
    ;

    companion object {
        private val BY_STORAGE = entries.associateBy { it.storageKey }

        /** 모르는 키는 null — 저장된 값이 어휘를 벗어나면 **없는 것으로 읽는다**(지어내지 않는다). */
        fun of(storageKey: String): AccountSettingKey? = BY_STORAGE[storageKey]
    }
}

/** 불리언 설정의 저장·해석. 문자열이 어휘를 벗어나면 **기본값으로 읽는다** — 저장이 깨졌다고 화면을 못 그리게 하지 않는다. */
object BooleanSetting {
    fun write(value: Boolean): String = value.toString()

    fun read(raw: String?, default: Boolean = false): Boolean = raw?.toBooleanStrictOrNull() ?: default
}
