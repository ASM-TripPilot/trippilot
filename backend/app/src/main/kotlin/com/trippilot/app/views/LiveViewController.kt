package com.trippilot.app.views

import com.trippilot.archive.adapter.`in`.web.VisitCheckController
import com.trippilot.archive.adapter.`in`.web.VisitCheckListResponse
import com.trippilot.auth.adapter.`in`.web.LocationConsentController
import com.trippilot.auth.adapter.`in`.web.LocationConsentResponse
import com.trippilot.core.error.DomainException
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.adapter.`in`.web.ItineraryController
import com.trippilot.itinerarygeneration.adapter.`in`.web.ItineraryResponse
import com.trippilot.planbdetection.adapter.`in`.web.TriggerController
import com.trippilot.planbdetection.adapter.`in`.web.TriggerListResponse
import com.trippilot.trip.adapter.`in`.web.TripController
import com.trippilot.trip.adapter.`in`.web.TripResponse
import org.slf4j.LoggerFactory
import org.springframework.format.annotation.DateTimeFormat
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * 여행 중 화면(라이브 일정) 첫 로딩 묶음 — 화면이 3단계로 나눠 부르던 5개 조회를 한 번에 준다(TRIP-1467).
 *
 * **각 섹션은 그 엔드포인트의 핸들러를 그대로 불러 만든다.** 섹션이 개별 엔드포인트와 같은 모양이어야
 * 앱이 이 응답을 그 엔드포인트의 캐시에 그대로 채워 넣을 수 있다(이후 갱신·무효화는 지금 경로 그대로).
 * 모양을 여기서 다시 조립하면 한쪽에 필드가 늘 때 갈라지고, 앱 캐시에는 모양이 다른 값이 조용히 들어간다.
 * 소유 검증·404 도 핸들러의 것이 그대로 적용된다.
 *
 * 실패 규칙:
 * - 여행이 없거나 남의 것이면 전체 404(개별 GET /trips/{id} 와 같다).
 * - 일정이 없으면 [LiveViewResponse.itinerary] 가 null 이고 날짜에 매인 섹션(triggers·visits)도 null 이다 —
 *   화면은 "아직 일정이 없어요"로 가고 그 둘을 부르지 않는다. 일정의 그 밖의 실패는 전체 오류다(화면이 그릴 것이 없다).
 * - triggers·visits·locationConsent 는 실패해도 나머지를 준다. 그 섹션은 null 이고 [LiveViewResponse.unavailable] 에
 *   사유가 실린다(INV-4 — 조용히 비우지 않는다). 화면은 그 섹션만 개별 엔드포인트로 다시 부르면 된다.
 */
@RestController
class LiveViewController(
    private val trips: TripController,
    private val itineraries: ItineraryController,
    private val triggers: TriggerController,
    private val visits: VisitCheckController,
    private val locationConsent: LocationConsentController,
    private val clock: Clock,
) {
    @GetMapping("/api/v1/trips/{tripId}/live")
    fun live(
        principal: Principal,
        @PathVariable tripId: UUID,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) day: LocalDate?,
    ): LiveViewResponse {
        val trip = trips.get(principal, tripId)
        val itinerary = try {
            itineraries.get(principal, tripId)
        } catch (e: ResourceNotFound) {
            null // 여행은 방금 확인했다 — 여기 404 는 "일정 미생성"이다
        }
        val unavailable = mutableListOf<UnavailableSection>()
        fun <T> section(name: LiveSection, read: () -> T): T? = try {
            read()
        } catch (e: Exception) {
            val code = (e as? DomainException)?.errorCode ?: ErrorCode.INTERNAL
            log.warn("라이브 화면 섹션 실패 — 나머지는 준다. section={} tripId={} code={}", name, tripId, code, e)
            unavailable += UnavailableSection(name, code.name)
            null
        }
        val liveDay = itinerary?.let { liveDay(it, day) }
        return LiveViewResponse(
            trip = trip,
            itinerary = itinerary,
            day = liveDay,
            triggers = itinerary?.let { section(LiveSection.TRIGGERS) { triggers.list(principal, tripId) } },
            visits = liveDay?.let { d -> section(LiveSection.VISITS) { visits.listByDay(principal, tripId, d) } },
            locationConsent = section(LiveSection.LOCATION_CONSENT) { locationConsent.get(principal) },
            unavailable = unavailable,
        )
    }

    /**
     * 화면이 방문 기록을 부를 날 — 앱의 규칙과 같다(`LiveItineraryPage` 의 liveDate, `resolveLiveState`):
     * 요청한 날이 일정에 있으면 그날, 아니면 오늘(서울), 오늘이 일정 밖이면 여행 전은 첫날·여행 뒤는 마지막 날.
     * 날짜가 다르게 나와도 틀린 값이 화면에 가지는 않는다 — 앱은 응답의 [LiveViewResponse.day] 키로만 캐시를 채운다.
     */
    private fun liveDay(itinerary: ItineraryResponse, requested: LocalDate?): LocalDate? {
        val dates = itinerary.days.map { it.date }
        if (dates.isEmpty()) return null
        if (requested != null && requested in dates) return requested
        val today = LocalDate.ofInstant(clock.instant(), TRAVEL_ZONE)
        return when {
            today in dates -> today
            today < dates.first() -> dates.first()
            else -> dates.last()
        }
    }

    private companion object {
        val log = LoggerFactory.getLogger(LiveViewController::class.java)
        val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}

data class LiveViewResponse(
    /** GET /trips/{tripId} 와 같은 모양. */
    val trip: TripResponse,
    /** GET /trips/{tripId}/itinerary 와 같은 모양. 일정이 없으면 null. */
    val itinerary: ItineraryResponse?,
    /** [visits] 의 날. 일정이 없거나 날이 없으면 null. */
    val day: LocalDate?,
    /** GET /trips/{tripId}/triggers 와 같은 모양. 일정이 없거나 실패하면 null. */
    val triggers: TriggerListResponse?,
    /** GET /trips/{tripId}/visits/days/{day} 와 같은 모양. [day] 가 없거나 실패하면 null. */
    val visits: VisitCheckListResponse?,
    /** GET /me/location-consent 와 같은 모양. 실패하면 null. */
    val locationConsent: LocationConsentResponse?,
    /** 실패한 섹션과 사유. 비어 있으면 null 인 섹션은 "해당 없음"이다. */
    val unavailable: List<UnavailableSection>,
)

data class UnavailableSection(val section: LiveSection, val code: String)

enum class LiveSection { TRIGGERS, VISITS, LOCATION_CONSENT }
