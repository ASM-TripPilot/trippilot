package com.trippilot.itinerarygeneration.application

/**
 * 외부(AI) 문자열을 저장 상한에 맞춰 자른다.
 *
 * 왜 자르고 거부하지 않나: 이 값들은 **표시용 부가정보**다. 길이 하나 때문에 22001 이 나면
 * 트랜잭션이 통째로 롤백돼 **정상 생성된 일정이 사라지고 500 이 나간다**(사용자 입력에는 @Size 로
 * 400 을 주지만, AI 응답은 사용자가 고칠 수 있는 값이 아니다 — 거부는 답이 아니다).
 *
 * 잘렸다는 사실은 말줄임표로 드러난다. 상한은 **컬럼 정의와 같은 값**이어야 한다(V2.12·V2.13).
 */
object BoundedText {
    const val DISTANCE_RANGE_MAX = 60
    const val PLACEMENT_REASON_MAX = 500

    fun clamp(value: String?, max: Int): String? {
        if (value == null || value.length <= max) return value
        return value.take(max - 1) + "…"
    }
}
