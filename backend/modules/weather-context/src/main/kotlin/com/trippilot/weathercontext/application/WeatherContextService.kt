package com.trippilot.weathercontext.application

import com.trippilot.weathercontext.api.ContextFacade
import com.trippilot.weathercontext.api.WeatherReading
import com.trippilot.weathercontext.domain.WeatherLookupFailed
import com.trippilot.weathercontext.domain.WeatherPort
import com.trippilot.weathercontext.domain.WeatherSnapshot
import com.trippilot.weathercontext.domain.WeatherSnapshotRepository
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant

/**
 * 날씨 조회 + 스냅숏 캐시(LC-U4-3).
 *
 * 읽기-통과 캐시다: 신선한 스냅숏이 있으면 그대로 쓰고, 없으면 외부를 한 번 부른 뒤 저장한다.
 * **재시도도 서킷도 두지 않는다**(P-RES-U4-1) — 짧은 시한으로 끊고 무발화로 간다.
 *
 * 실패 시 **행을 만들지 않는다**(INV-U4-09). "조회 실패"를 강수확률 0 같은 값으로 채워 저장하면
 * 그 값이 캐시에 남아 **없는 사실을 알리는** 근거가 된다.
 */
@Service
class WeatherContextService(
    private val weather: WeatherPort,
    private val snapshots: WeatherSnapshotRepository,
    private val clock: Clock,
) : ContextFacade {

    @Transactional
    override fun precipProbabilityForTrigger(gridKey: String, at: Instant): Int? =
        freshOrFetch(gridKey, at)?.precipProbability

    @Transactional
    override fun readingForDisplay(gridKey: String, at: Instant): WeatherReading? {
        // 표시는 만료분도 쓴다 — 사용자가 스스로 판단할 재료이므로(P-RES-U4-2 역방향 예외).
        val fresh = freshOrFetch(gridKey, at)
        val snapshot = fresh ?: snapshots.findLatest(gridKey) ?: return null
        return WeatherReading(
            snapshot.precipProbability, snapshot.warning, snapshot.baseAt,
            stale = !snapshot.isFreshAt(at),
        )
    }

    /**
     * 신선한 스냅숏을 돌려준다. 없으면 외부를 부르고 저장한다. **실패하면 null** 이고 아무것도 저장하지 않는다.
     *
     * null 의 뜻은 "비가 안 온다"가 아니라 **"모른다"** 다 — 호출자가 이를 뒤섞으면 무발화 원칙이 깨진다.
     */
    private fun freshOrFetch(gridKey: String, at: Instant): WeatherSnapshot? {
        snapshots.findLatest(gridKey)?.takeIf { it.isFreshAt(at) }?.let { return it }
        return try {
            snapshots.save(weather.fetch(gridKey, clock.instant()))
        } catch (e: WeatherLookupFailed) {
            // 관측에만 남긴다(BR-U4-05). 화면은 수동 경로를 유지하고, 트리거는 만들지 않는다.
            log.warn("기상 조회 실패 — 트리거를 만들지 않습니다(무발화). gridKey={}", gridKey, e)
            null
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(WeatherContextService::class.java)
    }
}
