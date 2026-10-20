package com.trippilot.weathercontext.adapter.out.external

import com.trippilot.weathercontext.api.AirGrade
import com.trippilot.weathercontext.api.AirRegion
import com.trippilot.weathercontext.domain.AirForecast
import com.trippilot.weathercontext.domain.AirForecastPort
import org.slf4j.LoggerFactory
import org.springframework.web.client.RestClient
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.concurrent.atomic.AtomicReference

/**
 * 에어코리아 대기질 예보통보 실 어댑터(`ArpltnInforInqireSvc/getMinuDustFrcstDspth` · 설계서 §4.2 · BR-SA-16).
 *
 * 한 번의 [fetchAirForecast] = HTTP 1건(PM25 줄이 없을 때만 2건 — 발표 단위 캐시는 서비스 몫, COST-SA-04). 응답의 `informGrade`
 * (`서울 : 좋음,제주 : 보통,…` 19 권역)를 권역별로 읽는다 — **등급 문자열은 그대로**다(공공누리 3유형 · 변경 금지, BR-SA-24).
 *
 * 실응답(2026-10-19)은 요청한 통보 코드와 무관하게 PM10·PM25·O3 와 그 날 발표분(05·11시 …)을 다 준다(PM10·PM25 요청 표본이 바이트
 * 단위로 같다) — 그래서 PM10 으로 한 번 묻고 **PM10·PM25 줄을 다** 읽는다. 원천이 요청 코드만 주게 바뀌어 PM25 줄이 없으면 PM25 를
 * 따로 묻는다. (코드, 예보 날짜)마다 **가장 최근 발표분**을 쓴다. 권역 이름을 모르는 칸·날짜·발표 시각을 못 읽는 줄은 그것만
 * 버린다(다른 권역을 살린다). 두 코드 모두 등급이 하나도 없으면 형식 깨짐이다 — 빈 예보를 '좋음'으로 읽지 않는다(INV-SA-2).
 *
 * 실패는 예외다(재요청 없음): 게이트웨이 거절은 [com.trippilot.weathercontext.domain.WeatherGatewayRefused] — 첫 코드에서 막히면
 * 둘째 코드는 묻지 않는다 — 시한·5xx·정상 아닌 결과 코드·형식 깨짐은 [com.trippilot.weathercontext.domain.WeatherLookupFailed].
 */
class AirKoreaAdapter(
    client: RestClient,
    private val baseUrl: String,
    private val serviceKey: String,
) : AirForecastPort {

    private val call = PublicDataCall(client, SOURCE, log)

    /** 마지막으로 본 모르는 권역 이름 — 바뀔 때만 WARN 한다. */
    private val unknownRegions = AtomicReference<Set<String>>(emptySet())

    override fun fetchAirForecast(searchDate: LocalDate): AirForecast {
        val first = rowsOf(PM10, searchDate)
        val rows = if (first.any { it.informCode() == PM25 }) first else first + rowsOf(PM25, searchDate)
        noteUnknownRegions(rows)
        val pm10 = latestOf(rows.filter { it.informCode() == PM10 })
        val pm25 = latestOf(rows.filter { it.informCode() == PM25 })
        val byDate = (pm10.keys + pm25.keys).associateWith { date ->
            val a = pm10[date]?.grades.orEmpty()
            val b = pm25[date]?.grades.orEmpty()
            (a.keys + b.keys).associateWith { AirGrade(pm10 = a[it], pm25 = b[it]) }
        }.filterValues { it.isNotEmpty() }
        if (byDate.isEmpty()) call.fail("형식 깨짐: PM10·PM25 등급 없음")
        val issuedAt = (pm10.values + pm25.values).maxOf { it.issuedAt }
        call.passed()
        return AirForecast(issuedAt.atZone(KST).toInstant(), byDate)
    }

    /** 그 코드로 물은 응답의 줄 전부 — 응답이 요청 코드만 주지 않으므로 코드는 읽는 쪽이 가린다. */
    private fun rowsOf(code: String, searchDate: LocalDate): List<JsonNode> {
        val body = call.get(uri(code, searchDate))
        val root = runCatching { MAPPER.readTree(body) }.getOrNull() ?: call.fail("형식 깨짐: JSON 아님")
        val result = root.at("/response/header/resultCode").valueText()
        if (result != OK_CODE) call.fail("resultCode=$result")
        val items = root.at("/response/body/items")
        val rows: Iterable<JsonNode> = when {
            items.isArray -> items
            items.isObject && items.get("item") != null -> items.get("item").let { if (it.isArray) it else listOf(it) }
            else -> call.fail("형식 깨짐: 항목 없음")
        }
        return rows.toList()
    }

    private fun JsonNode.informCode(): String? = this["informCode"].valueText()

    /**
     * 모르는 권역 이름(권역 개편·이름 변화) — 그 칸은 버려져 그 권역 목적지가 '등급 모름'이 된다(안전 쪽). 조용하면 원인이 안 보이므로
     * 바뀔 때만 WARN 한 번(파드 범위). 한글 이름만 싣는다 — 본문에서 온 다른 글자(되돌려 준 질의 등)는 싣지 않는다(SEC-SA-03).
     */
    private fun noteUnknownRegions(rows: List<JsonNode>) {
        val names = rows.flatMap { it["informGrade"].valueText().orEmpty().split(',') }
            .map { it.substringBefore(':', "").trim() }
            .filter { REGION_NAME.matches(it) && AirRegion.ofLabel(it) == null }
            .toSortedSet()
        if (unknownRegions.getAndSet(names) != names && names.isNotEmpty()) {
            log.warn("{} — 모르는 예보 권역 이름 {} 이 있습니다(권역 개편·이름 변화). 그 권역의 목적지는 등급을 모름으로 둡니다 — AirRegion 표를 확인하십시오.", SOURCE, names.take(5))
        }
    }

    /** 예보 날짜마다 가장 최근 발표분. */
    private fun latestOf(items: List<JsonNode>): Map<LocalDate, Release> {
        val result = HashMap<LocalDate, Release>()
        for (item in items) {
            val date = item["informData"].valueText()?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: continue
            val issuedAt = issuedAtOf(item["dataTime"].valueText()) ?: continue
            if (result[date]?.let { it.issuedAt >= issuedAt } == true) continue
            result[date] = Release(issuedAt, gradesOf(item["informGrade"].valueText()))
        }
        return result
    }

    /** `2026-10-19 11시 발표` → 그 시각(KST). */
    private fun issuedAtOf(dataTime: String?): LocalDateTime? {
        val m = dataTime?.let { DATA_TIME.find(it) } ?: return null
        val hour = m.groupValues[2].toInt().takeIf { it in 0..23 } ?: return null
        return runCatching { LocalDate.parse(m.groupValues[1]).atTime(hour, 0) }.getOrNull()
    }

    /** `서울 : 좋음,제주 : 보통` → 권역 → 등급(문자열 그대로). 모르는 권역·깨진 칸·빈 등급은 그 칸만 버린다. */
    private fun gradesOf(informGrade: String?): Map<AirRegion, String> = informGrade.orEmpty().split(',').mapNotNull { cell ->
        val colon = cell.indexOf(':')
        if (colon < 0) return@mapNotNull null
        val region = AirRegion.ofLabel(cell.substring(0, colon).trim()) ?: return@mapNotNull null
        val grade = cell.substring(colon + 1).trim().takeIf { it.isNotEmpty() } ?: return@mapNotNull null
        region to grade
    }.toMap()

    /** 질의 — 키는 직접 인코딩한다(`UriBuilder` 는 `+` 를 남겨 403). 이미 인코딩된 질의라 [URI] 로 넘긴다. */
    private fun uri(code: String, searchDate: LocalDate): URI = URI.create(
        "$baseUrl$PATH?serviceKey=${URLEncoder.encode(serviceKey, StandardCharsets.UTF_8)}" +
            "&returnType=json&numOfRows=100&pageNo=1&searchDate=$searchDate&InformCode=$code",
    )

    /** 값 노드의 글자 — 없거나 객체·배열·null 이면 null 이다(Jackson 3 의 `asString()` 은 객체·배열에서 라이브러리 예외를 던진다). */
    private fun JsonNode?.valueText(): String? = this?.takeIf { it.isValueNode && !it.isNull }?.asString()

    private data class Release(val issuedAt: LocalDateTime, val grades: Map<AirRegion, String>)

    private companion object {
        private val log = LoggerFactory.getLogger(AirKoreaAdapter::class.java)
        private val MAPPER = JsonMapper.builder().build()
        private val KST: ZoneId = ZoneId.of("Asia/Seoul")

        private const val SOURCE = "에어코리아 대기질"
        private const val PATH = "/getMinuDustFrcstDspth"
        private const val OK_CODE = "00"
        private const val PM10 = "PM10"
        private const val PM25 = "PM25"

        /** 발표 시각 — `2026-10-19 11시 발표`. */
        private val DATA_TIME = Regex("^(\\d{4}-\\d{2}-\\d{2})\\s*(\\d{1,2})\\s*시")

        /** 로그에 실어도 되는 권역 이름 — 한글 1~10자. */
        private val REGION_NAME = Regex("^[가-힣]{1,10}$")
    }
}
