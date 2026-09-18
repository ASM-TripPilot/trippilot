package com.trippilot.auth.api

import java.util.UUID

/**
 * 개인화 활용 동의 조회(C1 auth) — 공개 계약(R1, `..api..`).
 *
 * [ConsentFacade] 에 얹지 않은 이유는 **파급**이다. 그쪽은 온보딩·부트스트랩이 물고 있는 계약이라
 * 메서드 하나가 구현체와 테스트 대역을 함께 건드린다. 여기 호출자는 개인화(U5)이고 묻는 것도
 * 하나다 — "이 계정이 개인화에 동의했는가".
 */
interface PersonalizationConsentFacade {
    /**
     * `PERSONALIZATION` 약관에 **현재** 동의 상태인가(BR-U5-44).
     *
     * 동의한 적 없음·철회함이 모두 false 다. 둘을 구분하지 않는 이유는 결과가 같기 때문이다 —
     * 어느 쪽이든 과거 기록을 추천 입력에 넣지 않는다.
     */
    fun isPersonalizationGranted(accountId: UUID): Boolean
}
