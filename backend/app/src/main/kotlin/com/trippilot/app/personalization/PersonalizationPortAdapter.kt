package com.trippilot.app.personalization

import com.trippilot.itinerarygeneration.domain.PersonalizationHints
import com.trippilot.itinerarygeneration.domain.PersonalizationPort
import com.trippilot.reflection.api.PersonalizationFacade
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 일정 생성의 [PersonalizationPort] ↔ 개인화(U5) 연결 — **조립은 app 이 한다**(TRIP-556).
 *
 * 이 클래스가 모듈이 아니라 app 에 있는 이유는 순환이다:
 * `archive → itinerary-generation`(방문 실적이 계획 슬롯을 읽는다) 인데 `reflection → archive` 라,
 * 일정 생성이 reflection 을 직접 물면 `archive → itinerary-generation → reflection → archive` 가
 * 닫힌다. **양쪽을 다 아는 곳은 app 뿐이다** — `OutboxSubscriber` 배선과 같은 꼴이다.
 *
 * 여기서 **판정을 하지 않는다.** 동의 게이트도 근거 임계도 저쪽(U5) 규칙이라, 이 어댑터가 하는
 * 일은 타입을 옮기는 것뿐이다. 여기에 조건을 하나라도 두면 규칙이 두 곳에 흩어진다.
 */
@Component
class PersonalizationPortAdapter(private val personalization: PersonalizationFacade) : PersonalizationPort {

    override fun hintsFor(accountId: UUID): PersonalizationHints {
        val view = personalization.deriveFor(accountId)
        return PersonalizationHints(activities = view.activities, pace = view.pace)
    }
}
