package com.trippilot.weathercontext.adapter.out.external

import com.trippilot.weathercontext.api.ActiveWarning
import com.trippilot.weathercontext.domain.WarningStatusPort
import org.slf4j.LoggerFactory
import org.springframework.web.client.RestClient
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicReference

/**
 * 기상청 기상특보 현황 실 어댑터(`WthrWrnInfoService/getPwnStatus` · 설계서 §4.2 · BR-SA-16).
 *
 * 한 번의 [fetchWarnings] = HTTP 1건 — 전국 발효 특보 문장(`t6`) 하나를 읽는다(목적지 매칭은 감지기 몫). 20분 기억은 서비스가 하고,
 * 여기서는 **같은 발표(`tmFc`·`tmSeq`)면 다시 파싱하지 않는다**(COST-SA-03). 예비특보(`t7`)·참고(`other`)는 읽지 않는다.
 *
 * 실패는 예외다(재요청 없음 — 다음 회차에 다시 묻는다): 게이트웨이 거절은 [com.trippilot.weathercontext.domain.WeatherGatewayRefused],
 * 시한·5xx·정상 아닌 결과 코드·`t6` 를 못 읽음은 [com.trippilot.weathercontext.domain.WeatherLookupFailed]. 못 읽은 `t6` 를
 * '특보 없음'으로 접지 않는다(INV-SA-2).
 */
class KmaWarningAdapter(
    client: RestClient,
    private val baseUrl: String,
    private val serviceKey: String,
) : WarningStatusPort {

    private val call = PublicDataCall(client, SOURCE, log)

    /** 마지막으로 읽은 발표(`tmFc/tmSeq`)와 그 특보 — 같은 발표면 그대로 쓴다. */
    private val last = AtomicReference<Pair<String, List<ActiveWarning>>?>(null)

    override fun fetchWarnings(): List<ActiveWarning> {
        val body = call.get(uri())
        val root = runCatching { MAPPER.readTree(body) }.getOrNull() ?: call.fail("형식 깨짐: JSON 아님")
        val code = root.at("/response/header/resultCode").valueText()
        if (code != OK_CODE) call.fail("resultCode=$code")
        val item = latest(root.at("/response/body/items/item")) ?: call.fail("형식 깨짐: 항목 없음")
        val release = releaseOf(item)
        last.get()?.takeIf { release != null && it.first == release }?.let {
            call.passed()
            return it.second
        }
        val t6 = item["t6"].valueText() ?: call.fail("형식 깨짐: t6 없음")
        val warnings = KmaWarningText.parse(t6) ?: call.fail("형식 깨짐: t6")
        if (release != null) last.set(release to warnings)
        call.passed()
        return warnings
    }

    /** 질의 — 키는 직접 인코딩한다(`UriBuilder` 는 `+` 를 남겨 403). 이미 인코딩된 질의라 [URI] 로 넘긴다. */
    private fun uri(): URI = URI.create(
        "$baseUrl$PATH?serviceKey=${URLEncoder.encode(serviceKey, StandardCharsets.UTF_8)}&pageNo=1&numOfRows=10&dataType=JSON",
    )

    /** 항목이 여럿이면 가장 최근 발표 — 보통은 하나다. 객체 하나로 와도 받는다. */
    private fun latest(items: JsonNode?): JsonNode? = when {
        items == null -> null
        items.isArray -> items.maxByOrNull { sortKeyOf(it) }
        items.isObject -> items
        else -> null
    }

    private fun sortKeyOf(item: JsonNode): String =
        item["tmFc"].valueText().orEmpty().padStart(12, '0') + item["tmSeq"].valueText().orEmpty().padStart(10, '0')

    /** 발표 표지 — 발표 시각과 순번이 다 있을 때만(없으면 늘 다시 읽는다). */
    private fun releaseOf(item: JsonNode): String? {
        val tmFc = item["tmFc"].valueText() ?: return null
        val tmSeq = item["tmSeq"].valueText() ?: return null
        return "$tmFc/$tmSeq"
    }

    /** 값 노드의 글자 — 없거나 객체·배열이면 null 이다(Jackson 3 의 `asString()` 은 그 셋에서 라이브러리 예외를 던진다). */
    private fun JsonNode?.valueText(): String? = this?.takeIf { it.isValueNode && !it.isNull }?.asString()

    private companion object {
        private val log = LoggerFactory.getLogger(KmaWarningAdapter::class.java)
        private val MAPPER = JsonMapper.builder().build()

        private const val SOURCE = "기상특보"
        private const val PATH = "/getPwnStatus"
        private const val OK_CODE = "00"
    }
}
