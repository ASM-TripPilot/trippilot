package com.trippilot.weathercontext.adapter.out.external

import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.weathercontext.domain.GridDay
import com.trippilot.weathercontext.domain.GridForecast
import com.trippilot.weathercontext.domain.GridForecastMissing
import com.trippilot.weathercontext.domain.GridForecastPort
import com.trippilot.weathercontext.domain.GridHour
import com.trippilot.weathercontext.domain.WeatherGatewayRefused
import com.trippilot.weathercontext.domain.WeatherLookupFailed
import com.trippilot.weathercontext.domain.WeatherPort
import com.trippilot.weathercontext.domain.WeatherSnapshot
import org.slf4j.LoggerFactory
import org.springframework.web.client.RestClient
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.atomic.AtomicReference

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
 *
 * ## 격자 경로(상황 감지 단기예보 · [GridForecastPort])
 *
 * 같은 `getVilageFcst` 응답 1건에서 오늘·내일의 시간별(POP·PTY·SKY·TMP·WSD)과 날짜별(TMN·TMX)을 읽는다 — 추가 호출 0.
 * 이름 경로와 다른 점은 셋이다(RES-SA-02·03 · COST-SA-02).
 * - **03(NO_DATA)만 즉시 ≤2회 다시 묻는다** — 기상청은 03 을 200 으로, 좌표·발표분과 무관하게 섞어 준다(실측 15회 중 6회).
 *   계정·키 오류·시한·5xx 는 다시 부르지 않는다(재시도 없음 기반선의 유일한 예외).
 * - **게이트웨이 거절을 따로 읽는다**([PublicDataGatewayError]) — XML 본문·401·403 을 형식 깨짐으로 섞지 않는다.
 *   상태가 바뀔 때만 WARN 한다(원인 코드만).
 * - **파드당 하루 상한**([KmaWeatherProperties.gridDailyCap])은 이 경로만 센다 — 이름 경로·도우미 날씨 카드는 세지 않는다.
 *   넘으면 부르지 않고 그 격자는 모름이다(WARN 은 하루 한 번).
 */
class KmaWeatherAdapter(
    private val regions: RegionLookupFacade,
    private val client: RestClient,
    private val properties: KmaWeatherProperties,
) : WeatherPort, GridForecastPort {

    /** 마지막 게이트웨이 상태 — null 이면 통과 중. 바뀔 때만 WARN 한다(파드 범위). */
    private val gateway = AtomicReference<String?>(null)

    private val quotaLock = Any()
    private var quotaDay: LocalDate? = null
    private var quotaUsed = 0
    private var capWarnedOn: LocalDate? = null

    override fun gridKeyOf(lat: Double, lng: Double): String = KmaGrid.of(lat, lng).let { (nx, ny) -> "$nx,$ny" }

    override fun fetchGrid(gridKey: String, at: Instant): GridForecast {
        val (nx, ny) = gridKey.split(',').map { it.trim().toInt() }
        val base = baseTimeAt(at)
        repeat(GRID_ATTEMPTS) {
            if (!takeQuota(at)) throw GridForecastMissing(gridKey, "격자 경로 하루 상한(${properties.gridDailyCap})")
            val (status, body) = exchange(uriOf(nx, ny, base), gridKey)
            PublicDataGatewayError.reasonOf(status, body)?.let { refused(it) }
            if (status !in 200..299) throw WeatherLookupFailed("기상청 격자 예보가 HTTP $status 로 응답했습니다. grid=$gridKey")
            val root = runCatching { MAPPER.readTree(body) }.getOrNull()
                ?: throw WeatherLookupFailed("기상청 격자 예보 본문이 JSON 이 아닙니다. grid=$gridKey")
            when (val code = root.at("/response/header/resultCode").asString()) {
                OK_CODE -> {
                    passed()
                    return gridOf(root, gridKey, base.atZone(KST).toInstant(), at)
                }
                NO_DATA_CODE -> passed() // 즉시 다시 묻는다
                // 메시지에 키가 에코될 수 있으므로 코드만 싣는다.
                else -> throw WeatherLookupFailed("기상청이 정상 응답이 아닙니다. resultCode=$code grid=$gridKey")
            }
        }
        throw GridForecastMissing(gridKey, "03 NO_DATA ${GRID_ATTEMPTS}회")
    }

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
    private fun call(nx: Int, ny: Int, base: LocalDateTime): JsonNode =
        client.get().uri(uriOf(nx, ny, base)).retrieve().body(JsonNode::class.java)
            ?: throw WeatherLookupFailed("기상청 응답 본문이 비어 있습니다. grid=$nx,$ny")

    /** 질의 — 이름·격자 경로가 같이 쓴다. 이미 인코딩된 질의라 다시 손대지 않게 URI 로 넘긴다. */
    private fun uriOf(nx: Int, ny: Int, base: LocalDateTime): URI {
        val query = buildString {
            append("serviceKey=").append(URLEncoder.encode(properties.serviceKey, StandardCharsets.UTF_8))
            append("&pageNo=1&numOfRows=").append(NUM_OF_ROWS)
            append("&dataType=JSON")
            append("&base_date=").append(base.format(DATE))
            append("&base_time=").append(base.format(TIME))
            append("&nx=").append(nx).append("&ny=").append(ny)
        }
        return URI.create("${properties.baseUrl}$FORECAST_PATH?$query")
    }

    /**
     * HTTP 1건 — 상태와 본문을 그대로 받는다(거절은 4xx·XML 로도 오므로 판독은 호출측이 한다).
     *
     * **원인 예외를 매달지 않고 종류만 싣는다** — 연결·시한 실패 메시지에는 요청 주소가 실리는데 그 질의 문자열에
     * 서비스 키가 있다(SEC-SA-03). 이 예외가 어디서 로그로 찍혀도 키가 새지 않게 한다.
     */
    private fun exchange(uri: URI, gridKey: String): Pair<Int, String> = try {
        client.get().uri(uri).exchangeForRequiredValue { _, res ->
            res.statusCode.value() to String(res.body.readAllBytes(), StandardCharsets.UTF_8)
        }
    } catch (e: Exception) {
        throw WeatherLookupFailed("기상청 격자 예보 호출 실패(${e.javaClass.simpleName}). grid=$gridKey")
    }

    /**
     * 발표분 → 격자 예보. **묻는 날짜**([at] 의 KST 오늘·내일)만 담는다 — 발표 날짜가 아니다(자정 직후엔 어제 23시 발표분).
     * 오늘·내일 칸이 하나도 없으면 정상 코드여도 형식 깨짐이다 — 빈 예보를 '정상'으로 캐시하면 다음 발표까지 모름이 '확인'처럼 돈다.
     */
    private fun gridOf(root: JsonNode, gridKey: String, baseAt: Instant, at: Instant): GridForecast {
        val today = at.atZone(KST).toLocalDate()
        val wanted = setOf(today, today.plusDays(1))
        val hours = LinkedHashMap<LocalDateTime, MutableMap<String, String>>()
        val days = LinkedHashMap<LocalDate, MutableMap<String, String>>()
        for (item in root.at("/response/body/items/item")) {
            val date = runCatching { LocalDate.parse(item["fcstDate"].asString(), DATE) }.getOrNull() ?: continue
            if (date !in wanted) continue
            val category = item["category"]?.asString() ?: continue
            val value = item["fcstValue"]?.asString()?.trim() ?: continue
            when (category) {
                "TMN", "TMX" -> days.getOrPut(date) { HashMap() }[category] = value
                in HOURLY -> {
                    val time = runCatching { LocalTime.parse(item["fcstTime"].asString(), TIME) }.getOrNull() ?: continue
                    hours.getOrPut(date.atTime(time)) { HashMap() }[category] = value
                }
            }
        }
        if (hours.isEmpty()) throw WeatherLookupFailed("기상청 격자 예보에 오늘·내일 칸이 없습니다. grid=$gridKey")
        return GridForecast(
            gridKey = gridKey,
            baseAt = baseAt,
            hourly = hours.mapValues { (_, v) ->
                GridHour(
                    pop = v["POP"]?.toIntOrNull()?.takeIf { it in 0..100 },
                    pty = v["PTY"]?.toIntOrNull()?.takeIf { it in PTY_CODES },
                    sky = v["SKY"]?.toIntOrNull()?.takeIf { it in SKY_CODES },
                    tmp = celsius(v["TMP"]),
                    wsd = v["WSD"]?.toDoubleOrNull()?.takeIf { it in WIND_RANGE },
                )
            },
            daily = days.mapValues { (_, v) -> GridDay(tmn = celsius(v["TMN"]), tmx = celsius(v["TMX"])) },
            fetchedAt = at,
            // 다음 발표가 실제로 제공되는 시각까지 — 그 10분 동안 손에 넣을 수 있는 가장 새 근거라서다.
            expiresAt = baseAt.plus(Duration.ofHours(PUBLISH_INTERVAL_HOURS)).plus(Duration.ofMinutes(PROVIDE_LAG_MIN)),
        )
    }

    /** 기온 — 결측 표식(-999·900 류)이 기온으로 들어오면 한파·폭염 오탐이 된다. 지상 기온으로 있을 수 없는 값은 모름이다. */
    private fun celsius(raw: String?): Double? = raw?.toDoubleOrNull()?.takeIf { it in TEMP_RANGE }

    /** 하루 상한 — KST 날짜가 바뀌면 다시 센다. 넘으면 false 이고 WARN 은 그 날 한 번이다. */
    private fun takeQuota(at: Instant): Boolean = synchronized(quotaLock) {
        val day = at.atZone(KST).toLocalDate()
        if (day != quotaDay) {
            quotaDay = day
            quotaUsed = 0
        }
        if (quotaUsed < properties.gridDailyCap) {
            quotaUsed++
            return true
        }
        if (capWarnedOn != day) {
            capWarnedOn = day
            log.warn("기상청 격자 예보 — 파드당 하루 상한({}건)에 닿았습니다. 오늘 남은 격자 조회는 부르지 않고 모름으로 둡니다.", properties.gridDailyCap)
        }
        false
    }

    private fun refused(code: String): Nothing {
        if (gateway.getAndSet(code) != code) {
            log.warn("기상청 격자 예보 — 공공데이터포털 게이트웨이가 거절했습니다(원인 코드 {}). 그 출처를 모름으로 두고 다음 회차에 다시 묻습니다.", code)
        }
        throw WeatherGatewayRefused(code)
    }

    private fun passed() {
        val was = gateway.getAndSet(null) ?: return
        log.info("기상청 격자 예보 — 게이트웨이 거절(원인 코드 {})이 풀렸습니다.", was)
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
        private const val NO_DATA_CODE = "03" // NODATA_ERROR — 200 으로 무작위로 섞여 온다

        private val MAPPER = JsonMapper.builder().build()

        /** 격자 경로 시도 수 = 1 + 03 즉시 재요청 2(RES-SA-03). */
        private const val GRID_ATTEMPTS = 3

        /** 격자 경로가 읽는 시간별 카테고리 — 판정이 읽는 칸만(PCP·SNO·REH·UUU·VVV·VEC·WAV 는 읽는 곳이 없다). */
        private val HOURLY = setOf("POP", "PTY", "SKY", "TMP", "WSD")

        /** 단기예보 PTY 0(없음)~4(소나기). 5~7 은 초단기 전용이다. */
        private val PTY_CODES = 0..4

        /** SKY 1(맑음)·3(구름많음)·4(흐림). 2(구름조금)는 2019년 폐지. */
        private val SKY_CODES = setOf(1, 3, 4)

        private val TEMP_RANGE = -60.0..60.0
        private val WIND_RANGE = 0.0..80.0

        /** 발표시각 8회 고정 + 제공 지연 ~10분(활용가이드). */
        private val BASE_HOURS = listOf(2, 5, 8, 11, 14, 17, 20, 23)
        private const val PROVIDE_LAG_MIN = 10L
        private const val PUBLISH_INTERVAL_HOURS = 3L

        /** 1개 발표분 ≈ 카테고리 12종 × 시간 슬롯 ≤ ~900건. 한 번에 받는다(호출 1건 계약). */
        private const val NUM_OF_ROWS = 1500
    }
}
