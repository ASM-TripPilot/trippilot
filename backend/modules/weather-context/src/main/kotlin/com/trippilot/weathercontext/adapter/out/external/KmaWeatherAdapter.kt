package com.trippilot.weathercontext.adapter.out.external

import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.weathercontext.domain.WeatherLookupFailed
import com.trippilot.weathercontext.domain.WeatherPort
import com.trippilot.weathercontext.domain.WeatherSnapshot
import org.slf4j.LoggerFactory
import org.springframework.web.client.RestClient
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import tools.jackson.databind.JsonNode
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 기상청 단기예보 실 어댑터(`getVilageFcst` · TRIP-849).
 *
 * ## 무엇을 고치나
 *
 * Plan-B 우천 트리거가 [FakeWeatherAdapter] 위에서 돌고 있었다 — 격자 키 해시로 만든 **가짜
 * 강수확률**이라, 비가 오는 날 안 뜨고 안 오는 날 뜬다. 조용히 틀리는 쪽이라 아무도 못 알아챈다.
 *
 * ## `gridKey` 가 지역명인 이유
 *
 * 포트 계약이 "격자 키. 좌표→격자 변환은 어댑터가 소유한다(벤더마다 다르다)" 이고, 호출측
 * (`WeatherTriggerService`)이 넘기는 값은 **목적지 이름**이다. 그래서 여기서 이름 → 대표 좌표
 * → 격자로 두 번 옮긴다. 호출측이 좌표를 알게 만드는 대신 이 순서를 고른 이유는 그쪽 주석에
 * 이미 적혀 있다 — *"실 벤더 어댑터가 붙으면 지역명→격자 매핑이 그 어댑터 안에서 필요해진다."*
 *
 * ## 실패는 예외다
 *
 * 포트 계약이 그렇다 — `null` 을 돌려주면 **"조회했더니 비 안 옴"과 구분되지 않아** 호출자가
 * 무발화(INV-U4-09)와 정상 결과를 섞어 판단하게 된다. 재시도·서킷은 두지 않는다(P-RES-U4-1).
 *
 * ## 호출 1건 계약
 *
 * 한 번의 [fetch] 가 HTTP 호출 **정확히 1건**이다. 공공데이터포털 일일 한도를 아끼는 것이 이유고,
 * 캐시는 상위(`WeatherContextService` + `(격자, 발표시각)` 키)가 맡는다.
 */
class KmaWeatherAdapter(
    private val regions: RegionLookupFacade,
    private val client: RestClient,
    private val properties: KmaWeatherProperties,
) : WeatherPort {

    override fun fetch(gridKey: String, at: Instant): WeatherSnapshot {
        val center = regions.centerOf(gridKey)
            ?: throw WeatherLookupFailed("지역 '$gridKey' 의 대표 좌표를 찾지 못해 격자를 정할 수 없습니다.")
        val (nx, ny) = KmaGrid.of(center.lat, center.lng)
        val base = baseTimeAt(at)

        val root = runCatching { call(nx, ny, base) }
            .getOrElse { throw WeatherLookupFailed("기상청 단기예보 호출에 실패했습니다. grid=$nx,$ny", it) }

        val code = root.at("/response/header/resultCode").asString()
        if (code != OK_CODE) {
            // 메시지에 키가 에코될 수 있으므로 코드만 싣는다.
            throw WeatherLookupFailed("기상청이 정상 응답이 아닙니다. resultCode=$code grid=$nx,$ny")
        }

        val baseAt = base.atZone(KST).toInstant()
        // **발표 날짜가 아니라 '묻는 날짜'로 고른다.** 자정 직후에는 전날 23시 발표분을 받으므로
        // 발표 날짜로 거르면 오늘 값을 하나도 못 찾는다 — 실 왕복에서 걸렸다(2026-09-16).
        val target = at.atZone(KST).toLocalDate()
        val pop = maxPopOn(root, target)
            ?: throw WeatherLookupFailed("응답에 $target 의 강수확률(POP)이 없습니다. grid=$nx,$ny")

        return WeatherSnapshot(
            gridKey = gridKey,
            baseAt = baseAt,
            precipProbability = pop,
            // 특보는 다른 API(기상특보 조회) 소관이라 여기서 지어내지 않는다.
            warning = null,
            fetchedAt = at,
            // TTL 을 임의로 정하지 않는다 — 다음 발표가 곧 새 캐시 키다(P-PERF-U4-1).
            expiresAt = baseAt.plus(Duration.ofHours(PUBLISH_INTERVAL_HOURS)),
        )
    }

    /**
     * **질의를 직접 조립한다.** `UriBuilder.queryParam` 에 인증키를 맡기면 `+` 가 그대로 남고,
     * 서버는 질의 문자열의 `+` 를 **공백으로 해석**해 키가 깨진다 → 403. 실측으로 겪었다
     * (2026-09-16 실 왕복): 같은 키가 파이썬 `urlencode`(`+` → `%2B`)로는 200 이었다.
     *
     * 가짜 서버는 키를 검증하지 않으므로 **단위 테스트는 전부 초록이었다** — 계약 게이트가
     * 초록이라고 상대가 받는다는 뜻이 아니라는 이 리포의 규칙이 여기서도 그대로 맞았다.
     */
    private fun call(nx: Int, ny: Int, base: LocalDateTime): JsonNode {
        val query = buildString {
            append("serviceKey=").append(URLEncoder.encode(properties.serviceKey, StandardCharsets.UTF_8))
            append("&pageNo=1&numOfRows=").append(NUM_OF_ROWS)
            append("&dataType=JSON")
            append("&base_date=").append(base.format(DATE))
            append("&base_time=").append(base.format(TIME))
            append("&nx=").append(nx).append("&ny=").append(ny)
        }
        // 이미 인코딩된 질의라 다시 손대지 않게 URI 로 넘긴다.
        return client.get().uri(URI.create("${properties.baseUrl}$FORECAST_PATH?$query"))
            .retrieve().body(JsonNode::class.java)
            ?: throw WeatherLookupFailed("기상청 응답 본문이 비어 있습니다. grid=$nx,$ny")
    }

    /**
     * 그 날짜 예보 슬롯 `POP` 의 **최댓값**.
     *
     * 하루 중 한 번이라도 임계 이상이면 우천일로 본다 — 평균을 쓰면 오후에만 쏟아지는 날이
     * 묻힌다. 보수적인 쪽이 Plan-B 의 목적(대안 제시)에 맞는다.
     *
     * [date] 는 **묻는 날짜**(호출 시각의 KST 날짜)이지 발표 날짜가 아니다. 자정 직후에는 전날
     * 23시 발표분을 받으므로 둘이 다르다 — 발표 날짜로 거르면 오늘 값을 하나도 못 찾는다.
     *
     * 그 날짜가 응답에 없으면 `null` 이다. **다른 날짜로 대체하지 않는다** — 그러면 내일
     * 예보로 오늘을 판단하게 되고, 그건 틀린 근거로 개입하는 것이다(BR-U4-05).
     */
    private fun maxPopOn(root: JsonNode, date: LocalDate): Int? {
        val wanted = date.format(DATE)
        return root.at("/response/body/items/item")
            .filter { it["category"].asString() == "POP" && it["fcstDate"].asString() == wanted }
            // 상대가 숫자를 문자열로 준다(가이드·실측). toIntOrNull 로 받아 깨진 값은 버린다.
            .mapNotNull { it["fcstValue"].asString().trim().toIntOrNull() }
            .filter { it in 0..100 }
            .maxOrNull()
    }

    /**
     * 지금 받을 수 있는 **가장 최근 발표분**.
     *
     * 발표는 하루 8회(02·05·…·23시)이고 API 제공은 발표 후 약 10분 뒤다. 그 지연을 안 빼면
     * 방금 발표된 시각을 요청해 **빈 응답**을 받는다 — 그 실패는 "날씨를 못 봤다"로 보여
     * 원인이 안 보인다.
     */
    private fun baseTimeAt(at: Instant): LocalDateTime {
        val kst = at.atZone(KST).toLocalDateTime().minusMinutes(PROVIDE_LAG_MIN)
        val hour = BASE_HOURS.lastOrNull { it <= kst.hour }
        return if (hour == null) {
            // 자정~02:10 사이 — 어제 23시 발표분이 최신이다.
            kst.toLocalDate().minusDays(1).atTime(BASE_HOURS.last(), 0)
        } else {
            kst.toLocalDate().atTime(hour, 0)
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(KmaWeatherAdapter::class.java)
        private val KST: ZoneId = ZoneId.of("Asia/Seoul")
        private val DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyyMMdd")
        private val TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("HHmm")

        private const val FORECAST_PATH = "/getVilageFcst"
        private const val OK_CODE = "00" // NORMAL_SERVICE

        /** 발표시각 8회 고정 + 제공 지연 ~10분(활용가이드). */
        private val BASE_HOURS = listOf(2, 5, 8, 11, 14, 17, 20, 23)
        private const val PROVIDE_LAG_MIN = 10L
        private const val PUBLISH_INTERVAL_HOURS = 3L

        /** 1개 발표분 ≈ 카테고리 12종 × 시간 슬롯 ≤ ~900건. 한 번에 받는다(호출 1건 계약). */
        private const val NUM_OF_ROWS = 1500
    }
}
