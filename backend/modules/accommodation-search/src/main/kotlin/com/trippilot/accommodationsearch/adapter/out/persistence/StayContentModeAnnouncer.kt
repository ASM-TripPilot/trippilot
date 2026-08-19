package com.trippilot.accommodationsearch.adapter.out.persistence

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import jakarta.annotation.PostConstruct
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component

/**
 * 어떤 숙소 콘텐츠 경로로 떴는지 기동 로그에 남긴다.
 *
 * 스텁은 **제주 5곳뿐**이라 다른 지역 검색이 전부 0건이 된다. 그게 "그 지역에 숙소가 없다"로 읽히면
 * 원인을 찾는 데 한참 걸린다 — 어느 경로인지 한 줄이 그걸 막는다(설정 의도와 결과가 다를 때 특히).
 */
@Component
class StayContentModeAnnouncer(
    private val port: AccommodationContentPort,
    @param:Value("\${trippilot.stay.content.mode:stub}") private val mode: String,
) {
    @PostConstruct
    fun announce() {
        val live = port.javaClass.simpleName
        if (port is DbContentAdapter) {
            log.info("숙소 콘텐츠 = DB 정본 · 구현={}", live)
        } else {
            log.info("숙소 콘텐츠 = 스텁(제주 5곳) · 구현={} — 다른 지역은 0건이 정상이다", live)
        }
        // 아는 값이 아니면 조건부 빈이 안 걸려 스텁으로 남는다 — 설정 의도와 결과가 다르다는 뜻이다.
        if (!mode.equals("stub", ignoreCase = true) && !mode.equals("db", ignoreCase = true)) {
            log.warn("trippilot.stay.content.mode='{}' 는 아는 값이 아닙니다(stub|db) — 스텁으로 동작합니다.", mode)
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(StayContentModeAnnouncer::class.java)
    }
}
