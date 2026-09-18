package com.trippilot.auth.api.event

import com.trippilot.core.event.DomainEvent

/**
 * GPS 기록 동의(L3) 철회 — **저장된 위치정보를 지우라는 신호**(INV-L4).
 *
 * ## 왜 이벤트인가
 *
 * 파기 대상 데이터는 저마다 다른 모듈이 갖고 있다(사진 EXIF 좌표는 archive). auth 가 그것을 직접
 * 지우려면 archive 를 의존해야 하는데 **archive 는 이미 auth 를 의존한다** — 순환이라 R1(ArchUnit)이
 * 막는다. 소유자가 자기 데이터를 지우는 것이 경계상으로도 맞다.
 *
 * ## 구독자가 지켜야 할 것
 *
 * - **멱등**: at-least-once 라 같은 철회가 두 번 올 수 있다. "좌표를 null 로" 는 두 번 해도 같다.
 * - **파기 사실 기록**: 무엇을 얼마나 지웠는지는 지운 쪽만 안다. `LocationLegalLogFacade.recordPurge` 로
 *   자기 scope 를 남긴다 — auth 가 대신 `gps_track` 하나로 뭉쳐 적으면 **실제로 지운 것과 기록이 어긋난다.**
 */
data class GpsRecordingOptOut(
    override val aggregateId: String,
    /** 왜 꺼졌나 — 사용자가 직접 철회했는지, 계정 삭제에 딸려 꺼졌는지. 로그 `reason` 이 된다. */
    val reason: String,
) : DomainEvent {
    override val eventType: String = "auth.GpsRecordingOptOut"
    override val aggregateType: String = "Account"

    companion object {
        const val REASON_REVOKED = "L3_REVOKED"
        const val REASON_ACCOUNT_DELETION = "account_deletion"
    }
}
