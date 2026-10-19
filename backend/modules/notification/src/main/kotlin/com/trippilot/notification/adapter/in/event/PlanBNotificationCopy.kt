package com.trippilot.notification.adapter.`in`.event

/**
 * Plan-B 알림 문구(BR-SA-21 ①) — 제목은 kind 로 3종, 본문은 사유와 같이 알린 나머지 수.
 *
 * **변형(12종)별 제목을 두지 않는다** — 사유를 되풀이하고, '~로 나와요'를 단정으로 뒤집고, '폭염·한파'가
 * 특보처럼 읽힌다. '대안을 준비했어요'도 쓰지 않는다 — 선계산은 꺼짐·상한·열린 세션으로 생략될 수 있어
 * 거짓 약속이 된다.
 */
internal object PlanBNotificationCopy {

    /**
     * 감지(C9)의 `TriggerKind` 4종 — 이 밖의 값은 모르는 값이다(BR-SA-21 ③). 종류는 늘리지 않는다(DEC-U4-4).
     * payload 를 트리로만 읽으므로 발행측 enum 을 참조하지 않는다(R1).
     */
    private val KINDS = setOf("WEATHER", "CLOSURE", "DELAY", "MANUAL")

    /** 그 밖(지연·수동)·옛 사건·모르는 값의 제목 — 종전 상수 그대로다. */
    private const val TITLE_OTHER = "일정을 다시 짜는 게 좋겠어요"

    /** 사유가 없을 때. 상대 날짜어('오늘')를 담지 않는다 — 알림함에 남아 다음 날 틀린 말이 된다(BR-SA-12). */
    private const val BODY_DEFAULT = "일정에 영향을 주는 상황이 감지됐어요"

    fun isKnownKind(kind: String?): Boolean = kind in KINDS

    fun title(kind: String?): String = when (kind) {
        "WEATHER" -> "날씨가 일정에 영향을 줄 수 있어요"
        "CLOSURE" -> "가려던 곳의 영업을 확인해 주세요"
        else -> TITLE_OTHER
    }

    /** 알림 본문 상한(BR-SA-12 ① '트리거 사유와 알림 본문은 200자 이하') — 사유 칸(200자)과 같다. */
    private const val BODY_MAX = 200

    /**
     * 사유 + 같이 알린 나머지가 있으면 ` (외 N건)`. 꼬리를 붙여 200자를 넘으면 **꼬리를 뺀다** — 사유를 자르면
     * 날짜·장소 이름이 잘려 다른 말이 된다. 사유는 트리거 사유 칸(200자)에서 오므로 그 자체로 상한 안이다.
     */
    fun body(reason: String?, others: Int): String {
        val base = reason?.takeIf { it.isNotBlank() } ?: BODY_DEFAULT
        val withOthers = "$base (외 ${others}건)"
        return if (others > 0 && withOthers.length <= BODY_MAX) withOthers else base
    }
}
