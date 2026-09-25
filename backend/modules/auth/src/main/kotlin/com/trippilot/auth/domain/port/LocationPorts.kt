package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.location.LocationConsent
import com.trippilot.auth.domain.location.LocationLegalEvent

/** 위치 동의 3층 현재 상태 포트(계정당 1행 upsert). */
interface LocationConsentStateRepository {
    fun find(accountId: AccountId): LocationConsent?

    fun save(state: LocationConsent): LocationConsent
}

/** 위치 법정 로그 포트 — **추가 전용**(INV-LL1). */
interface LocationLegalLogRepository {
    fun append(event: LocationLegalEvent)

    /**
     * 보존기간(기록 시점부터 6개월 — 위치정보법 제16조②)이 지난 확인자료를 파기하고 건수를 돌려준다.
     *
     * append-only(INV-LL1)의 예외가 아니다 — 앱은 여전히 이 테이블에 DELETE 가 없고, 이 호출은
     * "만료분 정리"라는 동작이 고정된 DB 함수(V2.49, SECURITY DEFINER)의 실행일 뿐이다.
     * 임의 조건 삭제는 이 포트로도 불가능하다.
     */
    fun purgeExpired(): Int
}
