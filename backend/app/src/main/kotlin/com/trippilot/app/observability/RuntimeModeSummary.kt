package com.trippilot.app.observability

import org.slf4j.LoggerFactory
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.core.env.Environment
import org.springframework.stereotype.Component

/**
 * 기동 로그에 **모드 스위치 전부를 한 줄로** 찍는다(TRIP-850).
 *
 * ## 안내자가 이미 있는데 왜 또 찍나
 *
 * 스위치마다 안내자가 있고 각자 자기 줄을 남긴다(`RegionGeocodeModeAnnouncer` 등 일곱).
 * 그런데 **그 일곱 줄이 수백 줄짜리 기동 로그에 흩어진다.** 한 줄을 찾는 것은 되지만
 * **조합을 보는 것**은 안 된다 — 그리고 "내 환경이 남과 뭐가 다른가"는 항상 조합의 문제다.
 *
 * 실제로 겪은 일이다: 팀원마다 `.env` 가 갈려 같은 코드가 다르게 돌았는데, 로그를 나란히 놓고
 * 비교할 방법이 없어 **갈렸다는 사실 자체를 아무도 몰랐다.** 이 한 줄이면 슬랙에 붙여 비교된다.
 *
 * ## 무엇을 보여주나 — 설정값이다, 구현이 아니다
 *
 * 여기서 읽는 것은 **해석된 설정값**이다. "그 설정이 실제로 그 구현을 띄웠는가"는 각 안내자가
 * 자기 자리에서 **주입된 빈으로** 판정하고, 어긋나면 경고한다. 둘을 섞지 않는다 —
 * 이 줄이 빈을 보려면 모든 모듈의 포트를 `app` 이 알아야 하고, 그러면 모듈 경계(R1)가 무너진다.
 *
 * 그래서 이 줄은 **"내가 무엇을 주문했는가"** 이고, 안내자 일곱 줄이 **"무엇이 나왔는가"** 다.
 * 오타로 조건부 빈이 안 걸린 경우는 그 둘이 갈리고, 안내자의 `warn` 이 그것을 말한다.
 *
 * ## 비밀은 값을 찍지 않는다
 *
 * `SERVICE_AUTH_TOKEN`·`JWT_SIGNING_KEY` 는 **있음/없음만** 적는다(SECURITY-12). 그 둘은 모드가
 * 아니라 자격증명이지만, 비어 있으면 동작이 갈리므로(서비스 인증 생략·기동마다 새 서명키)
 * 같은 줄에서 보이는 편이 낫다.
 */
@Component
class RuntimeModeSummary(private val env: Environment) {

    @EventListener(ApplicationReadyEvent::class)
    fun announce() {
        val modes = SWITCHES.joinToString("  ") { (label, key, fallback) ->
            "$label=${env.getProperty(key, fallback)}"
        }
        val secrets = SECRETS.joinToString("  ") { (label, key) ->
            "$label=${if (env.getProperty(key).isNullOrBlank()) "없음" else "있음"}"
        }
        log.info(
            "[모드] env={} · {} · {}",
            env.getProperty("trippilot.deploy-env", env.getProperty("DEPLOY_ENV", "local")),
            modes,
            secrets,
        )
    }

    companion object {
        private val log = LoggerFactory.getLogger(RuntimeModeSummary::class.java)

        /** 경로가 실재하는지 세는 가드용([RuntimeModeSummaryTest]). */
        internal fun switchPaths() = SWITCHES.map { it.second }

        internal fun secretPaths() = SECRETS.map { it.second }

        /** 경로 → 이 줄이 든 기본값. 실제 선언과 같아야 한다. */
        internal fun switchDefaults() = SWITCHES.associate { it.second to it.third }

        /**
         * (표시명, 프로퍼티 경로, 기본값). **기본값은 `application.yml` 과 같아야 한다** —
         * 다르면 이 줄이 실제와 다른 말을 한다. 새 스위치를 만들면 여기에 한 줄을 더한다.
         */
        private val SWITCHES = listOf(
            Triple("geocode", "trippilot.place.geocode.mode", "stub"),
            Triple("stay", "trippilot.stay.content.mode", "stub"),
            Triple("weather", "trippilot.weather.mode", "fake"),
            Triple("schedule", "trippilot.ai.schedule.mode", "fake"),
            Triple("reflect", "trippilot.ai.reflection.mode", "rule"),
            Triple("push", "trippilot.push.mode", "off"),
            Triple("reminder", "trippilot.ai.reminder-copy.mode", "off"),
        )

        /**
         * 값은 절대 찍지 않는다 — 있음/없음만(SECURITY-12).
         *
         * 서비스 토큰은 **수신 쪽 경로**(`service-auth.token`)를 본다. 발신 쪽
         * (`ai.schedule.service-token`·`ai.reflection.service-token`)도 같은 `SERVICE_AUTH_TOKEN`
         * 을 읽으므로 셋 중 아무거나 같은 답을 준다 — 한 곳만 적어 줄을 짧게 둔다.
         */
        private val SECRETS = listOf(
            "서비스토큰" to "trippilot.service-auth.token",
            "JWT키" to "trippilot.jwt.signing-key",
        )
    }
}
