package com.trippilot.auth.api

import java.util.UUID

/**
 * 계정의 **삭제 유예 상태** 조회(C1 auth) — 다른 모듈이 "이 계정이 지금 삭제 대기 중인가"를 묻는 공개 계약(R1, `..api..`).
 *
 * [ConsentFacade] 에 얹지 않은 이유는 묻는 것이 다르기 때문이다 — 그쪽은 약관, 여기는 수명주기다. 호출자는 알림(U6)이다: 삭제를 요청한 계정에는
 * 리마인드·푸시를 멈춰야 하는데, 그 사실은 요청 이벤트(`AccountDeletionRequested`)가 **전해 줄 뿐** 지금도 그런지는 말해 주지 않는다.
 * 이벤트는 순서가 뒤바뀌거나 다시 배달될 수 있어(at-least-once) 이벤트만 따르면 철회한 계정의 예약을 뒤늦게 지운다 — 처리 시점의 **현재 상태**를
 * 물어 맞추는 것이 순서에 안 흔들린다.
 */
fun interface AccountStatusFacade {
    /** 삭제 유예(`DELETION_PENDING`) 중이면 true. 없는 계정·그 밖의 상태(활성·파기 완료)는 false. */
    fun isDeletionPending(accountId: UUID): Boolean
}
