package com.trippilot.notification.application

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * 계정당 푸시 발송 소프트 상한(COST-U6-01) — **시간 10건 · 일 50건**.
 *
 * "소프트"인 이유: 넘겨도 **버리지 않는다**(COST-U6-02). 푸시만 생략하고 알림함 행은 남아
 * catch-up 으로 전달된다 — 사용자 입장에서 알림이 사라지는 일이 없다.
 *
 * 설정으로 뺀 이유: 값 자체가 **관측 후 조정 예정**이다(재평가 트리거). 상한이 실제로 물리는지는
 * 억제 지표(OBS-U6-03 `reason=RATE_LIMITED`)로 보고, 그 수치를 보고 올리거나 내린다.
 *
 * 이 상한은 **정보성 알림 기준**이다(COST-U6-05) — 광고성은 애초에 이 경로로 나가지 않는다.
 *
 * ## 소폭 초과는 설계상 허용이다
 *
 * 판정이 "세고→보내기"라 **동시에 들어온 발송 둘이 같은 수를 보고 둘 다 통과**할 수 있다. 락으로
 * 막지 않는 이유는 이것이 하드 쿼터가 아니라 폭주 차단이기 때문이다 — 10건 상한에서 11건이 나가는
 * 것은 무해하고, 막으려는 것은 버그로 수백 건이 쏟아지는 경우다. 그 경우는 몇 건 지나면 바로 물린다.
 */
@ConfigurationProperties(prefix = "trippilot.notification.push-limit")
data class PushRateLimits(
    val hourly: Long = 10,
    val daily: Long = 50,
) {
    init {
        // 시간 상한이 일 상한보다 크면 시간 창이 영원히 안 물려 설정이 조용히 무의미해진다.
        require(hourly in 1..daily) { "시간 상한($hourly)은 1 이상이고 일 상한($daily) 이하여야 합니다." }
    }
}
