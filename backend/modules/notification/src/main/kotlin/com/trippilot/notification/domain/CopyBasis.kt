package com.trippilot.notification.domain

import java.security.MessageDigest

/**
 * 리마인드 문구의 **근거 지문** — 문구를 만들 때 본 그날 장소 이름 목록(순서 포함)의 짧은 해시.
 *
 * 문구는 "성산일출봉에서 시작해 섭지코지를 둘러보세요"처럼 **그날 장소 이름과 순서**를 말한다. 일정이 편집(직접·도우미)되거나 이전
 * 판으로 되돌려져도 예약은 다시 적재되지 않아, 발화 때 같은 지문을 지금 일정에서 다시 계산해 비교해야 낡은 이름이 나가지 않는다.
 *
 * - **순서를 포함한다** — "A 에서 시작"은 순서가 바뀌면 거짓이 된다.
 * - **이름만 본다** — 카테고리 표기·좌표·시각이 바뀌는 것은 문구의 사실을 바꾸지 않는다.
 * - 이름 사이는 문자열에 안 나오는 구분자(US, 0x1F)로 잇는다 — `["가나", "다"]` 와 `["가", "나다"]` 가 같은 해시가 되지 않게.
 * - 해시 충돌은 "낡은 문구가 그대로 나간다"로 이어지지만 64비트면 일정 하나가 우연히 같을 확률은 무시할 수 있다(보안 용도가 아니다).
 */
object CopyBasis {
    private const val SEPARATOR = '\u001F'

    fun of(placeNames: List<String>): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(placeNames.joinToString(SEPARATOR.toString()).toByteArray(Charsets.UTF_8))
        return digest.take(8).joinToString("") { "%02x".format(it) }
    }
}
