package com.trippilot.assistant.application

import com.trippilot.savedaccommodation.api.TripBaseStayFacade
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Component
import java.time.temporal.ChronoUnit
import java.util.UUID

/**
 * 도우미가 "지금 어떤 여행을 보고 있는가"를 읽는 **한 곳**(BR-U8-02·03).
 *
 * 시트 상단 칩과 AI 에 보낼 스냅샷이 서로 다른 원천에서 나오면, 칩은 부산이라는데 AI 는 다른 것을 본다.
 * 그래서 칩 문구를 여기서 만들고, 스냅샷(TRIP-1378)도 이 읽기 위에 얹는다. 클라이언트가 보낸 일정 내용은
 * 어디에도 쓰지 않는다 — 받는 것은 `tripId` 뿐이고 나머지는 권한을 확인한 뒤 직접 읽는다.
 */
@Component
class TripContextReader(
    private val trips: TripFacade,
    private val baseStays: TripBaseStayFacade,
) {
    /** 소유한 여행이면 컨텍스트, 없거나 남의 여행이면 null(호출측이 404 로 숨긴다). */
    fun read(accountId: UUID, tripId: UUID): TripContext? {
        val trip = trips.findGenerationContext(accountId, tripId) ?: return null
        val nights = ChronoUnit.DAYS.between(trip.startDate, trip.endDate).toInt()
        // 숙소가 여럿이면 첫 숙박일의 것을 말한다 — 칩은 한 줄이고, 날마다의 숙소는 진행 검토가 다룬다.
        val stayName = baseStays.findBaseStays(tripId, trip.startDate, trip.endDate).minByOrNull { it.date }?.name
        return TripContext(trip.destinations, nights, stayName)
    }
}

/** @property nights 숙박 수. 0 이면 당일 여행이다. */
data class TripContext(val destinations: List<String>, val nights: Int, val baseStayName: String?) {
    /** 칩 문구 — `부산 2박 3일 · 등록 숙소 서면`(`b01`). 숙소가 없으면 뒷부분을 뺀다(없는 것을 있다고 하지 않는다). */
    fun chip(): String {
        val where = destinations.joinToString("·").ifEmpty { "여행" }
        val span = if (nights == 0) "당일" else "${nights}박 ${nights + 1}일"
        return listOfNotNull("$where $span", baseStayName?.let { "등록 숙소 $it" }).joinToString(" · ")
    }
}
