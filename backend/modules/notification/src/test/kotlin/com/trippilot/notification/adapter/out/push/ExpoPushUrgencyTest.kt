package com.trippilot.notification.adapter.out.push

import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.PushMessage
import com.trippilot.notification.domain.PushUrgency
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient

/**
 * 종류별 긴급도가 **와이어에 실제로 실리는가**.
 *
 * 이 신호가 없으면 모든 푸시가 같은 등급으로 나가, 사용자가 취침 집중 모드를 켰을 때
 * `SLOT_PRE`(일정 5분 전)와 `REFLECTION`(어제 회고)이 **함께** 막힌다. 그런데 서버 로그에는
 * `SENT` 로 남아 그 사실이 어디에도 안 보인다 — 그래서 도메인이 아니라 **나가는 본문**을 잰다.
 */
class ExpoPushUrgencyTest : StringSpec({

    fun fixture(): Pair<ExpoPushAdapter, MockRestServiceServer> {
        val builder = RestClient.builder().baseUrl("http://expo.test")
        val server = MockRestServiceServer.bindTo(builder).build()
        return ExpoPushAdapter("", builder.build()) to server
    }

    val okBody = """{"data":[{"status":"ok"}]}"""

    fun expectWire(urgency: PushUrgency, level: String, priority: String) {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://expo.test/--/api/v2/push/send"))
            .andExpect(jsonPath("$[0].interruptionLevel").value(level))
            .andExpect(jsonPath("$[0].priority").value(priority))
            .andRespond(withSuccess(okBody, MediaType.APPLICATION_JSON))

        adapter.send(listOf("ExponentPushToken[x]"), PushMessage("제목", "본문", urgency = urgency))

        server.verify()
    }

    "시간 민감은 time-sensitive·high 로 나간다 — 집중 모드를 뚫어야 한다" {
        expectWire(PushUrgency.TIME_SENSITIVE, "time-sensitive", "high")
    }

    "보통은 active·default 다" {
        expectWire(PushUrgency.ACTIVE, "active", "default")
    }

    /** 조용한 등급은 `high` 를 쓰지 않는다 — 잠든 기기를 깨울 이유가 없다. */
    "조용한 것은 passive·normal 이다" {
        expectWire(PushUrgency.PASSIVE, "passive", "normal")
    }

    // ── 종류 → 긴급도 배정 ────────────────────────────────────────────
    /**
     * **시각이 곧 내용인 것만** 집중 모드를 뚫는다. 남발하면 사용자가 앱 단위로 그 권한을 꺼 버려
     * 정작 필요할 때 못 뚫는다 — 그래서 이 목록이 늘어나는 것 자체가 신호다.
     */
    "일정 시작 전과 Plan-B 만 시간 민감이다" {
        NotificationKind.entries.filter { it.urgency == PushUrgency.TIME_SENSITIVE }.toSet() shouldBe
            setOf(NotificationKind.SLOT_PRE, NotificationKind.PLAN_B)
    }

    "회고·커뮤니티는 조용하다 — 급하지 않다" {
        NotificationKind.entries.filter { it.urgency == PushUrgency.PASSIVE }.toSet() shouldBe
            setOf(NotificationKind.REFLECTION, NotificationKind.COMMUNITY)
    }

    /** 보안·계정은 뚫지 않는다 — 재난이 아니다. 다만 조용하지도 않다. */
    "SYSTEM 은 보통 등급이다" {
        NotificationKind.SYSTEM.urgency shouldBe PushUrgency.ACTIVE
    }

    /**
     * ⚠ `channelId` 를 싣지 않는 것이 **의도다.** Expo 는 기기에 없는 채널을 받으면 알림을
     * **표시하지 않는다** — 프론트에 `setNotificationChannelAsync` 가 아직 없어 지금 실으면
     * 안드로이드에서 조용히 사라진다(2026-09-02 실측).
     */
    "channelId 를 싣지 않는다 — 프론트가 채널을 만들기 전까지" {
        val (adapter, server) = fixture()
        server.expect(requestTo("http://expo.test/--/api/v2/push/send"))
            .andExpect(jsonPath("$[0].channelId").doesNotExist())
            .andRespond(withSuccess(okBody, MediaType.APPLICATION_JSON))

        adapter.send(listOf("ExponentPushToken[x]"), PushMessage("제목", "본문", urgency = PushUrgency.ACTIVE))

        server.verify()
    }
})
