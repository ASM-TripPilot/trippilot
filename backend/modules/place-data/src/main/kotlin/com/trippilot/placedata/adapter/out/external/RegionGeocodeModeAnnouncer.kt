package com.trippilot.placedata.adapter.out.external

import com.trippilot.placedata.domain.RegionGeocodePort
import jakarta.annotation.PostConstruct
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component

/**
 * 기동 시 **어느 지오코딩 경계가 살아 있는지**를 알린다. `ScheduleAgentModeAnnouncer` 와 같은 목적이다 —
 * 스위치가 안 걸려도 앱은 기본값(스텁)으로 정상 기동하므로, 그 침묵을 깨지 않으면
 * 국내강제가 시드 8개짜리 스텁으로 도는지 실 벤더로 도는지 로그로 구분할 수 없다.
 *
 * 판정은 설정값이 아니라 **실제 주입된 구현**으로 한다 — 설정과 결과가 어긋나는 경우가 문제라서다.
 *
 * ## 키가 비었으면 기동을 막는다
 *
 * 다른 모드 스위치와 달리 여기는 **경고로 끝내지 않는다.** `mode=kakao` 인데 키가 비면 카카오가 401 을
 * 주고 모든 판정이 [com.trippilot.placedata.api.DomesticCheck.UNKNOWN] 이 되는데,
 * `TripService` 는 `OUTSIDE` 만 막고 `UNKNOWN` 은 통과시킨다(장애가 곧 차단이 되면 안 되므로 옳다).
 * 그 둘이 겹치면 **INV-U1-12 가 사실상 꺼진 채로 정상 기동한다** — 해외 목적지가 전부 통과하고,
 * 로그를 뒤지지 않는 한 아무도 모른다.
 *
 * 기동 실패는 시끄럽고 배포 즉시 드러난다. 조용히 꺼진 불변식보다 그쪽이 낫다.
 * 스텁으로 돌리려면 `mode` 를 kakao 로 두지 않으면 된다 — 키 없이 kakao 를 켜는 것만 막는다.
 */
@Component
class RegionGeocodeModeAnnouncer(
    private val port: RegionGeocodePort,
    @param:Value("\${trippilot.place.geocode.mode:stub}") private val mode: String,
    @param:Value("\${trippilot.social.kakao.client-id:}") private val restApiKey: String,
) {

    @PostConstruct
    fun announce() {
        val live = port.javaClass.simpleName
        if (port is KakaoRegionGeocodeAdapter) {
            check(restApiKey.isNotBlank()) {
                "trippilot.place.geocode.mode=kakao 인데 카카오 REST API 키(KAKAO_CLIENT_ID)가 비어 있습니다. " +
                    "이대로 기동하면 모든 국내 판정이 UNKNOWN 이 되고 국내강제(INV-U1-12)가 통째로 무효가 됩니다. " +
                    "키를 주입하거나, 스텁으로 돌리려면 mode 를 kakao 가 아닌 값으로 두십시오."
            }
            log.info("지역 지오코딩 = 실 카카오 로컬 · 구현={}", live)
        } else {
            log.info("지역 지오코딩 = 내장 스텁 · 구현={} (시드에 없는 지역명은 국외로 판정된다)", live)
        }
        // 아는 값이 아니면 조건부 빈이 안 걸려 스텁으로 남는다 — 설정 의도와 결과가 다르다는 뜻이라 경고로 올린다.
        if (!mode.equals("stub", ignoreCase = true) && !mode.equals("kakao", ignoreCase = true)) {
            log.warn("trippilot.place.geocode.mode='{}' 는 아는 값이 아닙니다(stub|kakao) — 내장 스텁으로 동작합니다.", mode)
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(RegionGeocodeModeAnnouncer::class.java)
    }
}
