package com.trippilot.notification.adapter.out.push

import com.trippilot.notification.domain.PushMessage
import com.trippilot.notification.domain.PushRateLimited
import com.trippilot.notification.domain.PushReceipt
import com.trippilot.notification.domain.PushStatus
import com.trippilot.notification.domain.PushUrgency
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.types.shouldBeInstanceOf
import io.kotest.matchers.shouldBe
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.header
import org.springframework.test.web.client.match.MockRestRequestMatchers.headerDoesNotExist
import org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withStatus
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.HttpClientErrorException
import org.springframework.web.client.HttpServerErrorException
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

    /**
     * **ok 티켓의 id 가 영수증으로 이어진다.** 접수(SENT)와 도착은 다르고, 도착 실패(자격 누락·영수증으로만 드러나는 죽은 토큰)는
     * 이 id 로 15분 뒤 영수증을 조회해야 안다. id 가 파싱에서 사라지면 그 길이 막힌다. 실패 티켓에는 id 가 없다(Expo 계약).
     */
    "ok 티켓의 id 를 영수증에 싣고, 실패 티켓·id 없는 ok 는 id 가 없다" {
        val receipts = send(
            listOf("t1", "t2", "t3", "t4"),
            """{"data":[
                {"status":"ok","id":"ticket-1"},
                {"status":"error","message":"gone","details":{"error":"DeviceNotRegistered"}},
                {"status":"ok"},
                {"status":"ok","id":"  "}
            ]}""",
        )
        receipts shouldBe listOf(
            PushReceipt("t1", PushStatus.SENT, ticketId = "ticket-1"),
            PushReceipt("t2", PushStatus.DEVICE_NOT_REGISTERED, "DeviceNotRegistered"),
            PushReceipt("t3", PushStatus.SENT),      // 접수는 됐지만 추적할 id 가 없다
            PushReceipt("t4", PushStatus.SENT),      // 빈 id 는 id 가 아니다
        )
    }

    // ── 영수증 조회(getReceipts) ──────────────────────────────────────────

    fun fetch(ids: List<String>, response: String, accessToken: String = ""): Map<String, com.trippilot.notification.domain.TicketReceipt> {
        val builder = RestClient.builder().baseUrl("http://expo.test")
        val server = MockRestServiceServer.bindTo(builder).build()
        val call = server.expect(requestTo("http://expo.test/--/api/v2/push/getReceipts"))
            .andExpect(jsonPath("$.ids.length()").value(ids.size))
        ids.forEachIndexed { i, id -> call.andExpect(jsonPath("$.ids[$i]").value(id)) }
        if (accessToken.isBlank()) call.andExpect(headerDoesNotExist(HttpHeaders.AUTHORIZATION))
        else call.andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer $accessToken"))
        call.andRespond(withSuccess(response, MediaType.APPLICATION_JSON))
        val out = ExpoPushAdapter(accessToken, builder.build()).fetch(ids)
        server.verify()
        return out
    }

    /**
     * **영수증은 티켓 id → 결과 맵으로 온다**(토큰이 없다). ok 와 오류(코드는 `details.error`)를 갈라 읽고, 응답에 없는 id(아직 안
     * 만들어졌거나 24시간이 지나 사라짐)는 맵에서 빠진다 — 호출 쪽이 그 둘을 '아직 없음'으로 다룬다.
     */
    "영수증 응답을 티켓 id 별로 읽는다 — ok·오류 코드·없는 id" {
        val out = fetch(
            listOf("T1", "T2", "T3"),
            """{"data":{
                "T1":{"status":"ok"},
                "T2":{"status":"error","message":"The device cannot receive push notifications anymore","details":{"error":"DeviceNotRegistered"}}
            }}""",
        )

        out["T1"] shouldBe com.trippilot.notification.domain.TicketReceipt(true, null, null)
        out["T2"] shouldBe com.trippilot.notification.domain.TicketReceipt(false, "DeviceNotRegistered", "The device cannot receive push notifications anymore")
        out.containsKey("T3") shouldBe false
    }

    "영수증 조회에도 액세스 토큰이 있으면 같은 Bearer 규칙으로 싣는다" {
        fetch(listOf("T1"), """{"data":{"T1":{"status":"ok"}}}""", accessToken = "tok") shouldBe
            mapOf("T1" to com.trippilot.notification.domain.TicketReceipt(true, null, null))
    }

    "조회할 id 가 없으면 호출하지 않는다" {
        val builder = RestClient.builder().baseUrl("http://expo.test")
        val server = MockRestServiceServer.bindTo(builder).build()   // 기대가 없다 — 호출이 나가면 실패한다

        ExpoPushAdapter("", builder.build()).fetch(emptyList()) shouldBe emptyMap()

        server.verify()
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

    /**
     * **프로젝트 발송량 한도(HTTP 429)는 도메인 예외로 올린다** — 정본 COST-U6-04 의 재평가 트리거가 이 한도다.
     * 웹 예외 그대로 올리면 응용층이 네트워크·5xx 와 구분하지 못해 지표의 레이트리밋 칸이 이 경우를 못 본다.
     * 다른 HTTP 오류는 종전대로 그대로 올라간다. **어느 한도인지**는 응답 본문에만 있어, 그 정보가 예외 메시지에
     * 남아야 발송 실패 로그(`e.toString()`)가 종전과 같은 단서를 준다.
     */
    "429 는 PushRateLimited 로 — 원인과 응답 본문을 싣고, 다른 HTTP 오류는 그대로 올라간다" {
        fun respond(status: HttpStatus, body: String = ""): Throwable {
            val builder = RestClient.builder().baseUrl("http://expo.test")
            val server = MockRestServiceServer.bindTo(builder).build()
            server.expect(requestTo(url)).andRespond(withStatus(status).contentType(MediaType.APPLICATION_JSON).body(body))
            return runCatching { ExpoPushAdapter("", builder.build()).send(listOf("t1"), message) }.exceptionOrNull()!!
        }

        val limited = respond(
            HttpStatus.TOO_MANY_REQUESTS,
            """{"errors":[{"code":"TOO_MANY_REQUESTS","message":"project push rate exceeded"}]}""",
        ).shouldBeInstanceOf<PushRateLimited>()
        limited.cause.shouldBeInstanceOf<HttpClientErrorException.TooManyRequests>()
        // 고정 문구에도 "429" 가 있어 그것만으로는 원인이 실렸는지 모른다 — 상태 줄 전체와 본문을 본다.
        limited.message shouldContain "429 Too Many Requests"
        limited.message shouldContain "project push rate exceeded"

        respond(HttpStatus.SERVICE_UNAVAILABLE).shouldBeInstanceOf<HttpServerErrorException.ServiceUnavailable>()
    }

    /** 응답 본문은 상대가 정한다 — 아무리 길어도 **앞에서부터 300자**만 싣는다(앞이 상태 줄이라 단서가 거기 있다). */
    "429 원인 메시지는 앞에서부터 300자만 싣는다" {
        val prefix = "발송 서비스의 발송량 한도에 걸렸습니다(HTTP 429)"
        val detail = "a" + "x".repeat(10_000)

        PushRateLimited(detail).message shouldBe "$prefix — ${detail.take(300)}"
    }

    /** 300자 경계에 이모지(서로게이트 쌍)가 걸리면 반쪽 문자를 남기지 않고 그 문자째 뺀다 — 쌍이 경계 안에서 끝나면 남긴다. */
    "300자 경계에 걸린 서로게이트 쌍은 쪼개지 않는다" {
        val prefix = "발송 서비스의 발송량 한도에 걸렸습니다(HTTP 429)"
        val detail = "x".repeat(299) + "😀" + "뒤"

        PushRateLimited(detail).message shouldBe "$prefix — ${"x".repeat(299)}"
        // 완전한 쌍이 정확히 300자에서 끝나면 남긴다 — 덜 자르는 것은 쌍이 경계에서 쪼개질 때뿐이다.
        PushRateLimited("x".repeat(298) + "😀" + "뒤").message shouldBe "$prefix — ${"x".repeat(298)}😀"
    }
})
