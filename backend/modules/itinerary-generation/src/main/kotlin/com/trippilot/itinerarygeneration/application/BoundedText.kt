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
    const val REVISION_SUMMARY_MAX = 200 // itinerary_revision.summary(V2.14)
    const val REVISION_DETAIL_MAX = 500  // itinerary_revision.detail(V2.14)

    fun clamp(value: String?, max: Int): String? {
        if (value == null || value.length <= max) return value
        // 자를 위치가 서로게이트 페어 한가운데면 한 칸 물러선다 — 그냥 자르면 고아 서로게이트가 남아
        // UTF-8 인코딩에서 문자가 깨진다(AI 문구에 이모지가 섞일 수 있다).
        var cut = max - 1
        if (cut > 0 && value[cut - 1].isHighSurrogate()) cut -= 1
        return value.take(cut) + "…"
    }
}
