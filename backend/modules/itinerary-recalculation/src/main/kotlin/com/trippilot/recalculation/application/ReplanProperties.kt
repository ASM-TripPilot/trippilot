package com.trippilot.recalculation.application

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Configuration

/**
 * 지평(`PLANB_SITUATION_HORIZON` — 상황 감시 스윕과 **같은 키**, DEC-SA-7). 재계획이 읽는 것은 [PRE_TRIP] 하나다 —
 * 그때만 여행 전날 창이 열린다(BR-SA-20). 점검과 진입이 따로 켜지면 전날 알림 탭이 막다른 길(409)이 된다.
 */
enum class ReplanHorizon { TODAY, TOMORROW, PRE_TRIP }

/** 선계산 스위치(`PLANB_PREPARED_REPLAN`) — 켜면 위험 알림 사건마다 초안을 미리 짠다(LLM 비용). */
enum class PreparedMode { OFF, ON }

/**
 * 재계획 설정(situation-awareness §7 · 배포 키 배선은 상황 감시 스윕 변경이 먼저 했다).
 *
 * 모르는 값(`pre_trip`·`yes` 같은 오타)은 **바인딩 실패 = 기동 실패**다 — 켰다고 믿는데 꺼진 채 도는 것보다 낫다.
 * 하루 상한(여행 3·전체 100)과 대기 자리(실행 1 + 대기 10)는 설정이 아니라 상수다(O-SA-10 초기값 — 요청되지 않은 설정화 금지).
 */
@ConfigurationProperties(prefix = "trippilot.replan")
data class ReplanProperties(
    val horizon: ReplanHorizon = ReplanHorizon.TODAY,
    val prepared: Prepared = Prepared(),
) {
    data class Prepared(val mode: PreparedMode = PreparedMode.OFF)
}

/** 조건 없이 등록한다 — 스위치가 꺼져 있어도 진입 검증(전날 창)이 [ReplanProperties.horizon] 을 읽는다. */
@Configuration
@EnableConfigurationProperties(ReplanProperties::class)
class ReplanConfiguration
