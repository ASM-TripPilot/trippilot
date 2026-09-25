package com.trippilot.notification.adapter.out.external

import com.trippilot.notification.domain.ReminderCopy
import com.trippilot.notification.domain.ReminderCopyPort
import com.trippilot.notification.domain.ReminderCopyRequest
import org.slf4j.LoggerFactory

/**
 * 리마인드 문구 경계가 꺼져 있을 때의 폴백 — **항상 빈 결과**라 발화가 상수 문구로 간다(INV-4).
 *
 * **이름 있는 클래스인 이유.** 종전에는 설정 안의 익명 객체(`object : ReminderCopyPort`)였는데,
 * 익명 클래스는 `javaClass.simpleName` 이 **빈 문자열**이라 기동 안내가
 * `구현=` 까지만 찍고 끝났다(2026-09-26 실측). 어느 구현이 떴는지 이름으로 판정하는 것이
 * 안내자들의 규약이라(`RegionGeocodeModeAnnouncer` 선례) 그 자리를 비워 두면
 * **"꺼짐"과 "빈이 아예 안 만들어짐"이 로그에서 구별되지 않는다.**
 *
 * 선례는 회고 쪽 `UnwiredReflectionAgent` 다 — 같은 자리, 같은 이유로 이름을 가졌다.
 */
class UnwiredReminderCopy : ReminderCopyPort {

    override val enabled = false

    override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy> {
        log.debug("리마인드 문구 경계 미배선 — 상수 문구로 갑니다. 요청 {}건", items.size)
        return emptyMap()
    }

    private companion object {
        private val log = LoggerFactory.getLogger(UnwiredReminderCopy::class.java)
    }
}
