package com.trippilot.notification.adapter.out.push

import com.trippilot.notification.domain.PushMessage
import com.trippilot.notification.domain.PushReceipt
import com.trippilot.notification.domain.PushStatus
import com.trippilot.notification.domain.PushUrgency
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.header
import org.springframework.test.web.client.match.MockRestRequestMatchers.headerDoesNotExist
import org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient

/**
 * Expo 티켓 → 도메인 판정(INV-U6-07).
 *
 * 여기 판정이 틀리면 조용히 나쁜 일이 생긴다 — 죽은 토큰을 살려 두면 매번 헛발송하고,
 * 대응을 잃은 응답에서 엉뚱한 토큰을 `DEVICE_NOT_REGISTERED` 로 읽으면 **살아 있는 기기의 푸시가 영구히 끊긴다.**
 */
class ExpoPushReceiptTest : StringSpec({

    val url = "http://expo.test/--/api/v2/push/send"
    val message = PushMessage("제목", "본문", urgency = PushUrgency.ACTIVE)

    /** 나가는 본문의 `to` 가 입력 토큰 순서 그대로인지도 함께 본다 — 대응의 근거가 그 순서다. */
    fun send(tokens: List<String>, response: String?, accessToken: String = ""): List<PushReceipt> {
        val builder = RestClient.builder().baseUrl("http://expo.test")
        val server = MockRestServiceServer.bindTo(builder).build()
        val call = server.expect(requestTo(url))
        tokens.forEachIndexed { i, t -> call.andExpect(jsonPath("$[$i].to").value(t)) }
        call.andExpect(jsonPath("$.length()").value(tokens.size))
        if (accessToken.isBlank()) call.andExpect(headerDoesNotExist(HttpHeaders.AUTHORIZATION))
        else call.andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer $accessToken"))
        call.andRespond(if (response == null) withSuccess() else withSuccess(response, MediaType.APPLICATION_JSON))
        val receipts = ExpoPushAdapter(accessToken, builder.build()).send(tokens, message)
        server.verify()
        return receipts
    }

    "입력 순서대로 티켓을 토큰에 대응시킨다 — ok 는 SENT, DeviceNotRegistered 는 무효화 대상" {
        val receipts = send(
            listOf("t1", "t2", "t3", "t4", "t5"),
            """{"data":[
                {"status":"ok"},
                {"status":"error","message":"gone","details":{"error":"DeviceNotRegistered"}},
                {"status":"error","message":"too big","details":{"error":"MessageTooBig"}},
                {"status":"error","message":"rate limited"},
                {"status":"error"}
            ]}""",
        )
        receipts shouldBe listOf(
            PushReceipt("t1", PushStatus.SENT),
            PushReceipt("t2", PushStatus.DEVICE_NOT_REGISTERED, "DeviceNotRegistered"),
            PushReceipt("t3", PushStatus.FAILED, "MessageTooBig"),
            PushReceipt("t4", PushStatus.FAILED, "rate limited"),
            PushReceipt("t5", PushStatus.FAILED, "UNKNOWN"),
        )
    }

    "티켓 수가 토큰 수와 다르면 대응을 잃었으므로 전부 FAILED — 어느 토큰도 무효화하지 않는다" {
        val receipts = send(
            listOf("t1", "t2"),
            """{"data":[{"status":"error","details":{"error":"DeviceNotRegistered"}}]}""",
        )
        receipts shouldBe listOf(
            PushReceipt("t1", PushStatus.FAILED, "TICKET_COUNT_MISMATCH"),
            PushReceipt("t2", PushStatus.FAILED, "TICKET_COUNT_MISMATCH"),
        )
        // 티켓이 더 많아도 — zip 이 잘린 채 대응하면 밀린 DeviceNotRegistered 가 살아 있는 토큰을 무효화한다.
        send(listOf("t1"), """{"data":[{"status":"error","details":{"error":"DeviceNotRegistered"}},{"status":"ok"}]}""") shouldBe
            listOf(PushReceipt("t1", PushStatus.FAILED, "TICKET_COUNT_MISMATCH"))
    }

    "응답 본문이 비면 티켓 0개로 보고 전부 FAILED 다" {
        val receipts = send(listOf("t1"), null)
        receipts shouldBe listOf(PushReceipt("t1", PushStatus.FAILED, "TICKET_COUNT_MISMATCH"))
    }

    "액세스 토큰이 있으면 Bearer 로 싣고, 비어 있으면 Authorization 헤더 자체를 보내지 않는다" {
        send(listOf("t1"), """{"data":[{"status":"ok"}]}""", accessToken = "secret").single().status shouldBe PushStatus.SENT
        send(listOf("t1"), """{"data":[{"status":"ok"}]}""", accessToken = "").single().status shouldBe PushStatus.SENT
        send(listOf("t1"), """{"data":[{"status":"ok"}]}""", accessToken = "  ").single().status shouldBe PushStatus.SENT // 공백만 — 빈 Bearer 로 401
    }
})
