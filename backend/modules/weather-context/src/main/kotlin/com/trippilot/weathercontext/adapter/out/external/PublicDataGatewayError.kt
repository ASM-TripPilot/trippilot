package com.trippilot.weathercontext.adapter.out.external

import tools.jackson.databind.json.JsonMapper

/**
 * 공공데이터포털 게이트웨이 오류 판독기(RES-SA-02 · tech-stack 델타 5) — 공공데이터 어댑터들이 함께 쓴다.
 *
 * 게이트웨이는 키·한도·IP 를 상대 서비스보다 먼저 거른다. 그 거절은 **JSON 을 요청해도 XML 본문**으로 오고
 * (`OpenAPI_ServiceResponse/cmmMsgHeader/returnReasonCode` — 2026-10-19 실측 30), HTTP 401·403 으로 오기도 한다.
 * JSON 머리(`resultCode`)만 보면 XML 거절이 '형식 깨짐'으로 읽혀 원인(키 미등록)이 사라지고 장애·재시도 쪽으로 섞인다.
 *
 * 거절 코드 = 20(접근 거부) · 22(일일 한도 초과) · 30(등록되지 않은 키) · 31(기한 만료 키) · 32(등록되지 않은 IP).
 */
internal object PublicDataGatewayError {

    private val REFUSALS = setOf("20", "22", "30", "31", "32")
    private val XML_REASON = Regex("<returnReasonCode>\\s*(\\d+)\\s*</returnReasonCode>")
    private val MAPPER = JsonMapper.builder().build()

    /**
     * 게이트웨이 거절이면 원인 코드(`"30"` · HTTP 이면 `"HTTP_401"`), 아니면 null. 정상·자료 없음(03)·깨진 본문·5xx 는 null 이다 —
     * 그것들은 호출측이 정상·모름·장애로 따로 다룬다. 본문을 되돌려 주지 않는다(키가 에코될 수 있다).
     */
    fun reasonOf(status: Int, body: String?): String? {
        if (status == 401 || status == 403) return "HTTP_$status"
        val text = body?.trim().orEmpty()
        val code = if (text.startsWith("<")) XML_REASON.find(text)?.groupValues?.get(1) else jsonReason(text)
        return code?.takeIf { it in REFUSALS }
    }

    /** `cmmMsgHeader.returnReasonCode`(감싼 모양 무관) — 없으면 정상 응답 머리의 `resultCode`(같은 코드 체계). */
    private fun jsonReason(text: String): String? {
        val root = runCatching { MAPPER.readTree(text) }.getOrNull() ?: return null
        val reason = root.findValue("returnReasonCode") ?: root.at("/response/header/resultCode")
        return reason.takeIf { it.isValueNode }?.asString()
    }
}
