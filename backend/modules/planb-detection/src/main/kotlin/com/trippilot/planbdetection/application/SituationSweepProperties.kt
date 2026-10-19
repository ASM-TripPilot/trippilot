package com.trippilot.planbdetection.application

import com.trippilot.planbdetection.domain.SweepSource
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Configuration
import java.time.Duration
import java.util.Objects
import java.util.UUID

/** 스윕 모드(`PLANB_SITUATION_SWEEP`) — off · dry-run(판정·요약 로그만, 쓰기 0) · on. */
enum class SweepMode(val label: String) { OFF("off"), DRY_RUN("dry-run"), ON("on") }

/**
 * 지평(`PLANB_SITUATION_HORIZON`) — 저녁 회차가 어디까지 보나. today = 오늘만 · tomorrow = 진행 중 여행의 내일까지 ·
 * pre-trip = 내일 시작하는 여행의 첫날(D-1)까지.
 */
enum class SweepHorizon(val label: String) { TODAY("today"), TOMORROW("tomorrow"), PRE_TRIP("pre-trip") }

/**
 * Plan-B 상황 감시 스윕 설정(설계서 §7 · tech-stack 델타 6).
 *
 * 배포 스위치는 셋이다 — [mode]·[horizon]·[accountIds](운영 카나리, 비면 전원). 나머지는 yml 값이다:
 * [sources] = 부를 감지기, [observeOnly] = 결과를 로그에만 남길 출처(키 등록·실측 확인 뒤 여기서 빼는 커밋이 '켜기'),
 * [parallelism] = 여행 단위 병렬, [budget] = 회차 예산. 회차 시각(cron)은 스케줄 애너테이션이 같은 접두로 직접 읽는다.
 *
 * 모르는 모드·지평 값과 계정 id 오타는 **바인딩 실패 = 기동 실패**다 — 켰다고 믿는데 꺼진 채 도는 것보다 낫다.
 * 출처 이름 오타와 계정 목록의 빈 항목도 같다(아래 init).
 */
@ConfigurationProperties(prefix = "trippilot.planb.situation-sweep")
data class SituationSweepProperties(
    val mode: SweepMode = SweepMode.OFF,
    val horizon: SweepHorizon = SweepHorizon.TODAY,
    val accountIds: Set<UUID> = emptySet(),
    val sources: List<String> = listOf(SweepSource.KMA_FORECAST, SweepSource.KMA_WARNING, SweepSource.AIRKOREA, SweepSource.PLACE),
    val observeOnly: Set<String> = setOf(SweepSource.KMA_WARNING, SweepSource.AIRKOREA),
    val parallelism: Int = 2,
    val budget: Duration = Duration.ofMinutes(20),
) {
    init {
        // 0 이면 회차가 아무것도 못 보고 끝난다 — 끄려는 뜻이면 mode=off 다.
        require(parallelism >= 1) { "상황 스윕 병렬도($parallelism)는 1 이상이어야 합니다." }
        require(budget > Duration.ZERO) { "상황 스윕 예산($budget)은 0 보다 커야 합니다." }
        // 출처는 닫힌 집합이다. 관찰 전용 목록의 오타는 그 출처를 실측 전에 쓰기·푸시 대상으로 만든다(fail-unsafe — BR-SA-04).
        val unknown = (sources + observeOnly).filterNot { it in SweepSource.ALL }
        require(unknown.isEmpty()) { "모르는 감지기 출처입니다: $unknown — 출처는 ${SweepSource.ALL} 중 하나입니다." }
        // 공백만 든 값·끝 쉼표는 바인딩이 null 항목으로 읽는다 — 아무 계정도 안 맞는 목록이 되어 조용히 0 여행을 돈다.
        require(accountIds.none(Objects::isNull)) { "상황 스윕 대상 계정 목록에 빈 항목(공백만·끝 쉼표)이 있습니다." }
    }
}

/** 스윕 설정 등록 — 조건 없이 연다(스위치가 off 여도 감시 상태 OFF 판정이 이 값을 읽는다). */
@Configuration
@EnableConfigurationProperties(SituationSweepProperties::class)
class SituationSweepConfiguration
