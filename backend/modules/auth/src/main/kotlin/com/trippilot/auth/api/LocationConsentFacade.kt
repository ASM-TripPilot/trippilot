package com.trippilot.auth.api

import java.util.UUID

/**
 * 위치 동의 조회(C1 auth) — 공개 계약(R1, `..api..`).
 *
 * [ConsentFacade] 와 따로 두는 이유는 파급 때문이다. 그쪽은 온보딩·부트스트랩 판정용이라 구현체와
 * 테스트 대역이 여럿 붙어 있어, 메서드 하나가 그 전부를 건드린다. 위치 동의는 묻는 쪽도 답하는 쪽도
 * 다르다 — 3층 상태의 정본인 `LocationConsentService` 가 직접 구현한다.
 */
interface LocationConsentFacade {
    /**
     * GPS 발자취 기록 옵트인(L3)에 현재 동의했는가.
     *
     * 사진 EXIF 좌표를 받을지 말지의 **유일한 근거**다(INV-U5-04). 판정 결과를 소비 모듈이 자기 테이블에
     * 복사해 두면 철회가 그쪽에 반영되지 않아, 동의를 거둔 뒤에도 좌표가 계속 저장된다.
     * 미설정 계정은 `false` — 동의는 명시적으로만 생긴다.
     */
    fun hasGpsRecordingOptIn(accountId: UUID): Boolean
}
