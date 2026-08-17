package com.trippilot.placedata.application

import com.trippilot.placedata.domain.NormalizedPlace
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiCollectionGate
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.placedata.domain.PoiSource
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock

/**
 * 수집 제안 한 건(경계 표현). 카테고리는 **이미 정본 어휘로 옮겨진 상태**이며,
 * 옮기지 못했으면 null 이다 — 그 사실을 [PoiProposalIngestService] 가 탈락 사유로 센다.
 */
data class PoiProposal(
    val nameKo: String,
    val lat: Double?,
    val lng: Double?,
    val category: PoiCategory?,
    val region: String?,
    val openingHours: String?,
    /** 출처 원본 식별자(TourAPI contentId). 없으면 멱등할 수 없어 받지 않는다. */
    val sourceRef: String?,
)

/**
 * 수신 결과. **탈락을 사유별로 센다** — 총계만 주면 "왜 절반이 안 들어왔나"에 답할 수 없고,
 * 수집 쪽이 무엇을 고쳐야 하는지도 알 수 없다(INV-4 침묵 실패 금지).
 */
data class PoiIngestResult(
    val received: Int,
    val registered: Int,
    val updated: Int,
    val dropped: Map<String, Int>,
)

/**
 * AI 수집 등록 제안 수신(C7 · INV-1).
 *
 * **게이트를 반드시 태운다.** 상대가 자기 게이트를 통과시켰더라도 POI 정본 소유자는 C7 이고,
 * 후보풀에 무엇이 들어가는지는 우리 판정이다 — 상대 판정을 신뢰해 그대로 넣으면 INV-1 의 소유가 갈린다.
 *
 * **재실행이 행을 늘리지 않는다.** 수집은 매일 돌고 같은 장소가 계속 올라온다. `(source, sourceRef)` 로
 * 이미 아는 행을 찾아 **갱신**하고, 없을 때만 새로 만든다. 이 판정이 없으면 후보풀에 같은 장소가 쌓여
 * AI 가 하루 일정에 같은 곳을 두 번 넣는 형태로 사용자에게 드러난다.
 */
@Service
class PoiProposalIngestService(
    private val repo: PoiRepository,
    private val clock: Clock,
) {

    @Transactional
    fun ingest(source: PoiSource, proposals: List<PoiProposal>): PoiIngestResult {
        val now = clock.instant()
        val dropped = mutableMapOf<String, Int>()
        fun drop(reason: String) = dropped.merge(reason, 1, Int::plus)

        // 식별자가 없으면 다음 수집 때 같은 행을 못 찾는다 — 받아 두면 매일 중복이 쌓이므로 여기서 끊는다.
        val (identified, anonymous) = proposals.partition { !it.sourceRef.isNullOrBlank() }
        repeat(anonymous.size) { drop(DROP_NO_SOURCE_REF) }

        // 같은 문서 안에 같은 식별자가 두 번 오면 뒤엣것만 쓴다 — 한 트랜잭션에서 같은 행을 두 번 만들면
        // 부분 유니크 인덱스에 걸려 **문서 전체가 실패**한다(한 건 때문에 전부 잃는다).
        val deduped = identified.associateBy { it.sourceRef!! }
        repeat(identified.size - deduped.size) { drop(DROP_DUPLICATE_IN_DOCUMENT) }

        val known = repo.findBySourceRefs(source, deduped.keys)

        val toSave = mutableListOf<Poi>()
        var registered = 0
        var updated = 0

        deduped.forEach { (ref, proposal) ->
            val place = NormalizedPlace(
                nameKo = proposal.nameKo,
                lat = proposal.lat,
                lng = proposal.lng,
                category = proposal.category,
                region = proposal.region,
                openingHours = proposal.openingHours,
                source = source,
                sourceRef = ref,
            )
            // 게이트 판정은 여기 한 번뿐이다 — 통과 못 하면 신규든 갱신이든 손대지 않는다.
            if (!PoiCollectionGate.qualifies(place)) {
                drop(dropReasonFor(proposal))
                return@forEach
            }
            val existing = known[ref]
            if (existing == null) {
                toSave += PoiCollectionGate.promote(place, now)!!  // qualifies 통과분이라 null 이 아니다
                registered++
            } else {
                toSave += Poi.refreshed(
                    existing = existing,
                    nameKo = place.nameKo, lat = place.lat!!, lng = place.lng!!, category = place.category!!,
                    region = place.region, openingHours = place.openingHours, now = now,
                )
                updated++
            }
        }

        repo.saveAll(toSave)
        log.info(
            "POI 제안 수신 — 접수={} 신규={} 갱신={} 탈락={}",
            proposals.size, registered, updated, dropped,
        )
        return PoiIngestResult(proposals.size, registered, updated, dropped)
    }

    /**
     * 게이트 탈락 사유. 게이트 자체는 통과/불통만 말하므로(순수 판정) 사유는 여기서 되짚는다 —
     * 그래야 수집 쪽이 "좌표가 없어서인지 카테고리가 안 맞아서인지"를 안다.
     */
    private fun dropReasonFor(p: PoiProposal): String = when {
        p.nameKo.isBlank() -> DROP_NO_NAME
        p.lat == null || p.lng == null -> DROP_NO_COORD
        p.category == null -> DROP_UNKNOWN_CATEGORY
        else -> DROP_OTHER
    }

    companion object {
        private val log = LoggerFactory.getLogger(PoiProposalIngestService::class.java)

        const val DROP_NO_SOURCE_REF = "no_source_ref"
        const val DROP_DUPLICATE_IN_DOCUMENT = "duplicate_in_document"
        const val DROP_NO_NAME = "no_name"
        const val DROP_NO_COORD = "no_coord"

        /** 우리 8종에 없는 코드(예: AI 내부 전용 `STAY`) 또는 값 자체가 없음. */
        const val DROP_UNKNOWN_CATEGORY = "unknown_category"
        const val DROP_OTHER = "other"
    }
}
