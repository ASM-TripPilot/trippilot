package com.trippilot.notification.domain

import java.time.Instant
import java.util.UUID

/**
 * 알림 종류별 수신 설정(`l02` · U6 정본 §2.2).
 *
 * **행이 없는 것은 꺼진 것이 아니다.** 계정을 만들 때 7행을 미리 넣지 않고, 없으면 [defaultFor] 의
 * 기본값으로 동작한다 — 미리 넣으면 종류가 늘 때마다 기존 계정 전부에 백필이 필요하고, 백필이
 * 늦은 계정은 그 알림이 조용히 안 온다.
 */
data class NotificationToggle(
    val accountId: UUID,
    val kind: NotificationKind,
    val pushEnabled: Boolean,
    val inAppEnabled: Boolean,
    val updatedAt: Instant,
) {
    init {
        // INV-U6-04 — SYSTEM 행은 만들지 않는다. 만들면 언젠가 꺼진다.
        require(kind != NotificationKind.SYSTEM) { "SYSTEM 알림은 끌 수 없습니다." }
    }

    companion object {
        /**
         * 토글 가능한 종류 — `SYSTEM` 제외 7종(INV-U6-03·04).
         *
         * `COMMUNITY` 는 **남긴다**(INV-U6-05 · DEC-U6-8) — U7 개통 시 마이그레이션 0으로 켜기 위해서다.
         * 화면에서 숨기는 것은 클라이언트 몫이고, 서버가 어휘에서 빼면 그때 다시 넣어야 한다.
         */
        val TOGGLEABLE: List<NotificationKind> = NotificationKind.entries.filter { it != NotificationKind.SYSTEM }

        /**
         * 기본값(실물 `l02` 에서 읽음): `SLOT_PRE`·`PLAN_B` 는 **푸시 OFF · 인앱 ON**, 나머지 5종은 둘 다 ON.
         *
         * 앞의 둘만 푸시가 꺼져 있는 이유는 빈도다 — 일정마다·트리거마다 울리면 사용자가 알림 자체를
         * 통째로 꺼 버린다. 인앱은 남겨 두어 열었을 때 볼 수 있게 한다.
         */
        fun defaultFor(accountId: UUID, kind: NotificationKind, now: Instant): NotificationToggle {
            val quietPush = kind == NotificationKind.SLOT_PRE || kind == NotificationKind.PLAN_B
            return NotificationToggle(accountId, kind, pushEnabled = !quietPush, inAppEnabled = true, updatedAt = now)
        }
    }
}

/** 토글 영속 포트. */
interface NotificationToggleRepository {
    fun findByAccount(accountId: UUID): List<NotificationToggle>

    fun upsert(toggle: NotificationToggle): NotificationToggle
}
