package com.trippilot.app

import com.trippilot.affiliatelink.adapter.out.external.TripcomDeeplinkAdapter
import com.trippilot.affiliatelink.adapter.out.external.WebSearchFallbackAdapter
import com.trippilot.affiliatelink.domain.OtaDeeplinkPort
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.types.shouldBeInstanceOf
import org.springframework.boot.autoconfigure.AutoConfigurations
import org.springframework.boot.autoconfigure.context.PropertyPlaceholderAutoConfiguration
import org.springframework.boot.test.context.runner.ApplicationContextRunner

/**
 * **`AFFILIATE_MODE` 라는 이름이 실제로 어댑터를 바꾸는가**(선례: StayContentModeParityTest ·
 * ScheduleAgentSwitchTest — 같은 키를 다른 이름으로 읽어 조용히 스텁으로 남던 실패의 재발 방지).
 *
 * 배포가 주는 이름 그대로(`AFFILIATE_MODE=tripcom`) 넣어 **빈 선택까지** 잰다 — 이름이 틀리면
 * 폴백이 조용히 남아 모든 이동이 수수료 없이 나간다.
 */
class AffiliateModeSwitchTest : StringSpec({

    // application.yml 의 표기를 그대로 쓴다.
    val placeholders = arrayOf(
        "trippilot.affiliate.mode=\${AFFILIATE_MODE:fallback}",
        "trippilot.affiliate.tripcom.alliance-id=\${TRIPCOM_ALLIANCE_ID:}",
        "trippilot.affiliate.tripcom.sid=\${TRIPCOM_SID:}",
        "trippilot.affiliate.tripcom.ad-id=\${TRIPCOM_AD_ID:}",
    )

    fun runner() = ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(PropertyPlaceholderAutoConfiguration::class.java))
        .withBean(WebSearchFallbackAdapter::class.java)
        .withBean(TripcomDeeplinkAdapter::class.java)
        .withPropertyValues(*placeholders)

    "기본은 웹검색 폴백이다" {
        runner().run { ctx ->
            ctx.getBean(OtaDeeplinkPort::class.java).shouldBeInstanceOf<WebSearchFallbackAdapter>()
        }
    }

    "AFFILIATE_MODE=tripcom 이 실제로 트립닷컴 어댑터를 고른다 — 이름이 틀리면 조용히 폴백이다" {
        runner()
            .withSystemProperties(
                "AFFILIATE_MODE=tripcom",
                "TRIPCOM_ALLIANCE_ID=10768080",
                "TRIPCOM_SID=332381302",
                "TRIPCOM_AD_ID=D20021458",
            )
            .run { ctx ->
                ctx.getBean(OtaDeeplinkPort::class.java).shouldBeInstanceOf<TripcomDeeplinkAdapter>()
            }
    }
})
