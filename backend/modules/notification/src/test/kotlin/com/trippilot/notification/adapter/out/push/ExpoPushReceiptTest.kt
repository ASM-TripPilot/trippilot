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

    fun send(tokens: List<String>, response: String?, accessToken: String = ""): Pair<List<PushReceipt>, MockRestServiceServer> {
        val builder = RestClient.builder().baseUrl("http://expo.test")
        val server = MockRestServiceServer.bindTo(builder).build()
        val call = server.expect(requestTo(url))
        if (accessToken.isBlank()) call.andExpect(headerDoesNotExist(HttpHeaders.AUTHORIZATION))
        else call.andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer $accessToken"))
        call.andRespond(if (response == null) withSuccess() else withSuccess(response, MediaType.APPLICATION_JSON))
        val receipts = ExpoPushAdapter(accessToken, builder.build()).send(tokens, message)
        server.verify()
        return receipts to server
    }

    "입력 순서대로 티켓을 토큰에 대응시킨다 — ok 는 SENT, DeviceNotRegistered 는 무효화 대상" {
        val (receipts, _) = send(
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
        val (receipts, _) = send(
            listOf("t1", "t2"),
            """{"data":[{"status":"error","details":{"error":"DeviceNotRegistered"}}]}""",
        )
        receipts shouldBe listOf(
            PushReceipt("t1", PushStatus.FAILED, "TICKET_COUNT_MISMATCH"),
            PushReceipt("t2", PushStatus.FAILED, "TICKET_COUNT_MISMATCH"),
        )
    }

    "응답 본문이 비면 티켓 0개로 보고 전부 FAILED 다" {
        val (receipts, _) = send(listOf("t1"), null)
        receipts shouldBe listOf(PushReceipt("t1", PushStatus.FAILED, "TICKET_COUNT_MISMATCH"))
    }

    "액세스 토큰이 있으면 Bearer 로 싣고, 비어 있으면 Authorization 헤더 자체를 보내지 않는다" {
        send(listOf("t1"), """{"data":[{"status":"ok"}]}""", accessToken = "secret").first.single().status shouldBe PushStatus.SENT
        send(listOf("t1"), """{"data":[{"status":"ok"}]}""", accessToken = "").first.single().status shouldBe PushStatus.SENT
    }
})
