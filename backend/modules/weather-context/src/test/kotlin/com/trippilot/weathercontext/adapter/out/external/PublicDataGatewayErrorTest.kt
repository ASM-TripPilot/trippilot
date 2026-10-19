package com.trippilot.weathercontext.adapter.out.external

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/**
 * 공공데이터포털 게이트웨이 오류 판독(RES-SA-02) — 키·한도·IP 거절을 **JSON·XML 어느 본문에서든** 읽는다.
 *
 * JSON 을 요청해도 게이트웨이 오류는 XML 본문으로 온다(2026-10-19 실측 — 특보·대기질·특일이 30). 그것을 형식 깨짐으로
 * 읽으면 원인(키 미등록)이 사라지고 회로 차단·재시도 대상으로 섞인다.
 */
class PublicDataGatewayErrorTest : StringSpec({

    "XML 본문의 returnReasonCode 30 — 키 미등록" {
        PublicDataGatewayError.reasonOf(200, GATEWAY_XML_30) shouldBe "30"
    }

    "JSON 본문의 cmmMsgHeader.returnReasonCode — 감싼 모양이 달라도 찾는다" {
        PublicDataGatewayError.reasonOf(200, GATEWAY_JSON_30) shouldBe "30"
        PublicDataGatewayError.reasonOf(200, """{"cmmMsgHeader":{"returnReasonCode":"22"}}""") shouldBe "22"
    }

    "정상 응답 머리의 resultCode 가 거절 코드여도 게이트웨이 거절이다" {
        PublicDataGatewayError.reasonOf(200, """{"response":{"header":{"resultCode":"31","resultMsg":"DEADLINE_HAS_EXPIRED_ERROR"}}}""") shouldBe "31"
    }

    "HTTP 401·403 은 본문과 무관하게 게이트웨이 거절이다" {
        PublicDataGatewayError.reasonOf(401, "Unauthorized") shouldBe "HTTP_401"
        PublicDataGatewayError.reasonOf(403, "") shouldBe "HTTP_403"
    }

    "거절 코드 다섯(20·22·30·31·32)만 — 그 밖의 코드·정상·자료 없음은 게이트웨이 거절이 아니다" {
        listOf("20", "22", "30", "31", "32").forEach {
            PublicDataGatewayError.reasonOf(200, "<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>$it</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>") shouldBe it
        }
        PublicDataGatewayError.reasonOf(200, """{"response":{"header":{"resultCode":"00"}}}""") shouldBe null
        PublicDataGatewayError.reasonOf(200, """{"response":{"header":{"resultCode":"03"}}}""") shouldBe null
        PublicDataGatewayError.reasonOf(200, "<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>99</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>") shouldBe null
    }

    "깨진 본문·빈 본문·5xx 는 거절이 아니다 — 형식 깨짐·장애로 따로 다룬다" {
        PublicDataGatewayError.reasonOf(200, "{not json") shouldBe null
        PublicDataGatewayError.reasonOf(200, "<html>oops</html>") shouldBe null
        PublicDataGatewayError.reasonOf(200, null) shouldBe null
        PublicDataGatewayError.reasonOf(500, "") shouldBe null
    }
})

/** 포털 게이트웨이의 거절 본문(XML) — JSON 을 요청해도 이 모양으로 온다. */
internal const val GATEWAY_XML_30 = """<OpenAPI_ServiceResponse>
	<cmmMsgHeader>
		<errMsg>SERVICE ERROR</errMsg>
		<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg>
		<returnReasonCode>30</returnReasonCode>
	</cmmMsgHeader>
</OpenAPI_ServiceResponse>"""

/** 같은 거절의 JSON 모양. */
internal const val GATEWAY_JSON_30 =
    """{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICE ERROR","returnAuthMsg":"SERVICE_KEY_IS_NOT_REGISTERED_ERROR","returnReasonCode":"30"}}}"""
