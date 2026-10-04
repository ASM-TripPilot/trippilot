package com.trippilot.placedata.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.placedata.domain.PoiSource
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock

/**
 * 미포함 정리 결과. **`present` 는 요청 목록의 크기가 아니라 "목록에 있어 ACTIVE 로 남은 행 수"다** —
 * 그래서 동시 변경이 없으면 `activeBefore = present + closed` 가 성립한다(INV-4, 숫자로 드러낸다).
 *
 * [closedSourceRefs] 는 이번에 닫은(드라이런이면 닫을) 행의 식별자다(대조 시점 기준) — **되돌리기의 열쇠**.
 * 닫힌 시각(`updated_at`)은 다음 적재가 그 행을 갱신하면 덮이므로(`Poi.refreshed`) 시각만으로는 되찾지 못한다.
 */
data class PoiCloseMissingResult(
    val source: PoiSource,
    val activeBefore: Int,
    val present: Int,
    val closed: Int,
    val closedSourceRefs: List<String>,
)

/**
 * 원본에서 빠진 수집분을 닫는다(C7 · TRIP-1227).
 *
 * 제안 수신([PoiProposalIngestService])은 `(source, sourceRef)` upsert 라 **추가·갱신만** 한다. 원본에서 빠진 장소
 * (폐업·선별 제외·공유본에서 지운 행)는 정본에 ACTIVE 로 남아 후보풀에 계속 오른다 — 사용자에게는
 * 문 닫은 식당이 일정에 들어가는 것으로 보인다. 적재 스크립트가 문서를 500건씩 나눠 보내 **어느 수신 요청도
 * "이게 전부"라고 말하지 못하므로**, 그 출처의 식별자 전부를 따로 받아 대조한다 — **그 문서를 적재하기 전에**
 * 받아야 비율 가드가 성립한다([closeMissing] 안의 주석).
 *
 * **삭제가 아니라 CLOSED 다.** 담기(`saved_place` FK)와 확정 일정 스냅숏이 행을 가리키고, 담기 목록은
 * 폐업 배지로 보여 준다. 다시 문서에 나타나도 되살리지 않는다 — 상태는 수신이 덮지 않는 값이다(`Poi.refreshed`).
 */
@Service
class PoiCloseMissingService(
    private val repo: PoiRepository,
    private val clock: Clock,
) {

    // 대조와 쓰기를 한 트랜잭션으로 — 쓰기는 1,000개 묶음으로 나뉘어 나가므로(PoiRepositoryAdapter) 이 경계가 없으면
    // 중간 실패 때 앞 묶음만 닫힌 채 남는다. 이 경계를 고정하는 테스트는 일부러 두지 않았다(실패를 둘째 묶음에 심으려면
    // 컨텍스트를 갈라야 한다) — 빠지더라도 재실행이 멱등이라 같은 호출을 다시 하면 나머지가 닫힌다.
    @Transactional
    fun closeMissing(
        source: PoiSource,
        presentRefs: Collection<String>,
        allowMassClose: Boolean = false,
        dryRun: Boolean = false,
    ): PoiCloseMissingResult {
        // 수동 등록분(시드)은 어떤 문서에서 온 것도 아니라 "문서에 없음"이 아무 뜻이 없다 — 받으면 시드가 통째로 닫힌다.
        if (source == PoiSource.MANUAL) {
            throw ValidationFailed(listOf(FieldError("source", "MANUAL 은 문서로 들어온 출처가 아니라 미포함 정리 대상이 아닙니다.")))
        }
        val active = repo.findActiveSourceRefs(source)
        val listed = presentRefs.toSet()
        val missing = active.filterKeys { it !in listed }
        val present = active.size - missing.size

        // 목록 크기가 아니라 **맞물린 수**로 잰다 — 다른 출처의 식별자 목록을 잘못 보내면 크기는 충분해도 하나도 안
        // 맞물린다. 단 이 비교는 **그 문서를 적재하기 전에** 불러야 성립한다. 적재 뒤에 부르면 방금 만든 행이 스스로를
        // "목록에 있음"으로 세어, 식별자 체계가 통째로 바뀐 문서나 출처 라벨이 틀린 문서도 기존 ACTIVE 만큼만 크면
        // 409 없이 기존 행이 전부 닫힌다(리뷰 실측: 1,000건 재키잉 → 2,000 중 1,000 = 정확히 50% 로 통과).
        // 적재 스크립트가 닫기를 먼저 부르는 이유다 — 닫히는 집합은 적재 전후가 같다(적재는 목록 안의 행만 만든다).
        val mass = present < active.size * MIN_PRESENT_RATIO
        if (mass && !allowMassClose) {
            throw ConflictDetected(
                message = "$source ACTIVE ${active.size}건 중 목록에 있는 것이 ${present}건(${present * 100 / active.size}%)뿐이라 " +
                    "부분 문서로 보고 닫지 않았습니다(기준 ${(MIN_PRESENT_RATIO * 100).toInt()}%). " +
                    "의도한 대량 정리면 allow_mass_close=true.",
            )
        }
        val refs = missing.keys.toList()
        if (dryRun) {
            log.info("POI 미포함 정리 드라이런 — 출처={} ACTIVE={} 목록에있음={} 닫을것={}", source, active.size, present, refs.size)
            return PoiCloseMissingResult(source, active.size, present, refs.size, refs)
        }
        val closed = repo.closeActive(missing.values, clock.instant())

        if (mass) log.warn("POI 미포함 정리 — 비율 가드를 명시 플래그로 넘었다: 출처={} ACTIVE={} 목록에있음={}", source, active.size, present)
        log.info("POI 미포함 정리 — 출처={} ACTIVE={} 목록에있음={} CLOSED={}", source, active.size, present, closed)
        return PoiCloseMissingResult(source, active.size, present, closed, refs)
    }

    companion object {
        private val log = LoggerFactory.getLogger(PoiCloseMissingService::class.java)

        /**
         * 목록에 있는 ACTIVE 가 이 비율 미만이면 **부분 문서**로 보고 거부한다(409).
         *
         * 정상 갱신에서 빠지는 몫은 작다 — 수집분 음식점·카페 7,837건 중 폐업은 210건(2.7%, 2026-09-08 실측 ·
         * V2.50)이었고 그것도 여러 해 누적이다. 사고는 반대로 0 근처에서 난다 — 청크 하나(500)만 대조하면
         * LOCALDATA 11,181건의 4.5%, 다른 출처의 목록·식별자 체계가 바뀐 문서면 0%(적재 전에 잴 때), 수집 회차
         * artifact 한 장은 광역 17개 중 일부다.
         * 둘 사이가 넓어 절반이면 넉넉히 가른다 — 적재 런북이 "이상"으로 보는 선(신규+갱신이 접수의 절반 미만)과도 같다.
         * 선별 기준이 바뀌어 정말 절반 넘게 빠지는 경우(공백 해소 등)는 `allow_mass_close` 로만 통과한다.
         */
        const val MIN_PRESENT_RATIO = 0.5
    }
}
