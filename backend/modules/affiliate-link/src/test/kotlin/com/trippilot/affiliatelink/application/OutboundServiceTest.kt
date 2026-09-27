package com.trippilot.affiliatelink.application

import com.trippilot.accommodationsearch.api.StayLookupFacade
import com.trippilot.affiliatelink.adapter.out.external.WebSearchFallbackAdapter
import com.trippilot.affiliatelink.domain.OutboundClick
import com.trippilot.affiliatelink.domain.OutboundClickPort
import com.trippilot.affiliatelink.domain.OutboundQuery
import com.trippilot.core.error.ResourceNotFound
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldStartWith
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

private class FakeLookup(private val names: Map<String, String>) : StayLookupFacade {
    override fun findName(stayId: String): String? = names[stayId]
}

private class RecordingClicks : OutboundClickPort {
    val recorded = mutableListOf<OutboundClick>()
    override fun record(click: OutboundClick) { recorded += click }
}

private class BrokenClicks : OutboundClickPort {
    override fun record(click: OutboundClick) = error("DB down")
}

/**
 * 아웃바운드 302 (칸 1 · BR-U1-29~32).
 *
 * **이 스펙이 지키는 것은 셋이다.**
 *
 * 하나, **클릭이 남는다.** 계약 전부터 쌓이는 클릭이 어필리에이트 심사("운영 중인 매체")의
 * 근거다 — 기록이 조용히 빠지면 이 트랙의 존재 이유가 사라진다.
 *
 * 둘, **기록 실패가 이동을 막지 않는다.** 막으면 사용자에겐 "예약 버튼이 안 눌리는" 장애가 된다.
 *
 * 셋, **없는 숙소는 404 다.** 이름 없이는 폴백 URL 조차 만들 수 없다 — 지어내지 않는다.
 */
class OutboundServiceTest : StringSpec({

    val account = UUID.randomUUID()
    val now = Instant.parse("2026-09-27T03:00:00Z")
    val stayId = "STUB:jeju-001"

    fun svc(clicks: OutboundClickPort) = OutboundService(
        stays = FakeLookup(mapOf(stayId to "제주 오션 리조트")),
        deeplink = WebSearchFallbackAdapter(),
        clicks = clicks,
        clock = Clock.fixed(now, ZoneOffset.UTC),
    )

    "클릭 한 건이 남고 목적지는 웹검색 폴백이다" {
        val clicks = RecordingClicks()
        val query = OutboundQuery(LocalDate.parse("2026-10-01"), LocalDate.parse("2026-10-03"), 2)

        val link = svc(clicks).outbound(account, stayId, query)

        link.url shouldBe "https://www.google.com/search?q=" +
            URLEncoder.encode("제주 오션 리조트 예약", StandardCharsets.UTF_8)
        link.vendor shouldBe WebSearchFallbackAdapter.VENDOR
        val c = clicks.recorded.single()
        c.accountId shouldBe account
        c.stayId shouldBe stayId
        c.vendor shouldBe WebSearchFallbackAdapter.VENDOR
        c.query shouldBe query
        c.clickedAt shouldBe now
    }

    "기록 실패해도 302 는 산다 — 클릭 유실이 이동 실패보다 싸다" {
        val link = svc(BrokenClicks()).outbound(account, stayId, OutboundQuery())

        link.url shouldStartWith "https://www.google.com/search?q="
    }

    "없는 숙소는 404 — 폴백조차 만들 이름이 없다" {
        val clicks = RecordingClicks()

        shouldThrow<ResourceNotFound> {
            svc(clicks).outbound(account, "STUB:no-such", OutboundQuery())
        }
        clicks.recorded shouldBe emptyList()
    }
})
