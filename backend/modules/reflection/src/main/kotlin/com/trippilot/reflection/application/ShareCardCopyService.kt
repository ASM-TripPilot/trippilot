package com.trippilot.reflection.application

import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.RateLimited
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.reflection.domain.TripSummaryRepository
import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ReflectionVisit
import com.trippilot.reflection.domain.port.ShareCardCopy
import com.trippilot.reflection.domain.port.ShareCardCopyPort
import com.trippilot.reflection.domain.port.ShareCardUsageRepository
import com.trippilot.trip.api.TripFacade
import org.slf4j.LoggerFactory
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Duration
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * j06 공유 카드 문구(US-REC-13 · TRIP-1411) — 캡션 한 문단과 해시태그.
 *
 * **저장하지 않는다.** 카드는 기기에서 그려지고(BR-U5-46) 문구는 공유할 때마다 새로 받는다 — 저장할 사실이 없다.
 *
 * **트랜잭션을 열지 않는다.** 쓰는 것이 없고, AI 호출(정상 경로 상한 = 연결 + 읽기, 기본 24초 — [ShareCardCopyPort.maxWaitMs])을 기다리는 동안 DB 커넥션을 쥐지 않기 위해서다(TRIP-1463 교훈).
 * 각 퍼사드가 자기 읽기 트랜잭션을 열고 닫는다.
 *
 * **늘 답이 있다**(INV-4). AI 를 못 부르거나, 못 받거나, 상대가 자기 폴백으로 답하거나, 계약을 넘거나, 안 간 곳을 말하면 [ruleCopy] 로
 * 간다 — 이 경우 `isFallback=true` 다. 사유는 로그로 남는다. 예외는 429 둘뿐이다 — 같은 계정의 문구를 이미 짓고 있거나(`RATE_LIMITED`),
 * 하루 상한에 닿았다(`SHARE_CARD_DAILY_LIMIT`, AI 까지 갈 호출만 센다).
 */
@Service
class ShareCardCopyService(
    private val trips: TripFacade,
    private val archive: ArchiveRecordFacade,
    private val poiSurfaces: PoiSurfaceFacade,
    private val summaries: TripSummaryRepository,
    private val materials: ReflectionMaterials,
    private val copier: ShareCardCopyPort,
    private val usage: ShareCardUsageRepository,
    private val properties: ShareCardCopyProperties,
    private val clock: Clock,
) {
    /**
     * 지금 문구를 짓고 있는 계정 — 한 계정에 한 번에 하나다. 하루 상한만으로는 같은 계정의 동시 [공유] 30번이 전부 상한을 통과해
     * Tomcat 스레드 30개를 AI 응답까지(정상 경로 상한 = 연결 + 읽기, 기본 24초) 붙든다.
     */
    // ponytail: 파드 안에서만 센다 — 파드가 N 개면 한 계정이 최대 N 개를 동시에 짓는다. 넘치면 DB 의 계정 단위 잠금
    // (`pg_try_advisory_lock` 계열)으로 올린다 — 그러면 커넥션을 AI 응답까지 쥐게 되므로 그 비용과 같이 본다.
    private val inFlight: MutableSet<UUID> = ConcurrentHashMap.newKeySet()

    fun copy(accountId: UUID, tripId: UUID): ShareCardCopy {
        val ctx = trips.findGenerationContext(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        // 공유는 여행이 끝나 요약이 생긴 뒤다(BR-U5-48). 화면이 진입점을 막지만, 서버도 같은 규칙을 지킨다 — 진행 중 여행의 문구는
        // "다녀왔다"고 말하게 된다.
        if (!summaries.exists(tripId)) throw ConflictDetected(message = "여행이 끝나 요약이 생긴 뒤에 공유할 수 있어요.")
        val destinations = ctx.destinationRefs.map { it.name.trim() }.filter(String::isNotEmpty).distinct()
        val rule = ruleCopy(destinations)
        // 규칙 문구로 가는 갈래마다 사유를 남긴다(INV-4) — 빈 캡션만 보고는 꺼짐·재료 부족·AI 실패를 가를 수 없었다(TRIP-1701).
        if (!copier.enabled) {
            log.info("공유 문구 AI 가 꺼져 있어 규칙 문구로 갑니다(trippilot.ai.reflection.mode). tripId={}", tripId)
            return rule
        }

        val days = archive.findDailyVisits(tripId)
        val surfaces = poiSurfaces.findSurfaces(days.flatMap { d -> d.visits.map { it.poiId } })
        // 건너뛴 방문은 싣지 않는다 — 안 간 곳이 문구가 되면 안 된다(BR-U5-31). 순서는 그날 안의 순서다.
        val shown = days.flatMap { day ->
            day.visits.filterNot { it.skipped }.mapIndexedNotNull { index, v ->
                surfaces[v.poiId]?.let { ReflectionVisit(v.poiId, day.date, it.nameKo, it.category, index + 1, v.photoCount) }
            }
        }
        // 지역은 **첫 목적지 하나**다. 상대 게이트는 해시태그가 지역·방문지 이름을 부분으로 담아야 통과시키는데(`_tag_allowed`),
        // 목적지를 이어 붙인 "서울·부산"은 `#서울여행` 어디에도 들어가지 않아 지역 태그가 전부 위반이 된다. 다목적지 여행의 둘째
        // 목적지 태그는 그래서 상대가 거를 수 있다 — 거르면 아래 규칙 문구(목적지마다 태그)로 간다.
        val region = destinations.firstOrNull().orEmpty()
        if (!ReflectionAgentInput.callable(region, shown)) {
            val all = days.flatMap { it.visits }
            log.info(
                "공유 문구 재료가 없어 AI 를 부르지 않고 규칙 문구로 갑니다. tripId={} 목적지={} 간곳={} 건너뜀={} 장소없음={}",
                tripId, region.ifEmpty { "(없음)" }, shown.size, all.count { it.skipped }, all.count { it.poiId !in surfaces },
            )
            return rule
        }
        val input = ReflectionAgentInput(
            kind = KIND,
            region = region,
            startDate = ctx.startDate,
            endDate = ctx.endDate,
            visits = shown,
            personaSummary = materials.personaOf(accountId, ctx),
            // 날씨는 비운다 — 근거가 예보뿐이다([ReflectionMaterials] KDoc). 사건도 싣지 않는다: 공개 게시글 문구에 "들르지 못한 곳"·
            // "일정을 바꿨다"는 재료가 아니고, 싣지 않으면 변경 이력(최대 500행) 조회를 공유마다 하지 않아도 된다.
            weatherSummary = null,
            events = emptyList(),
        )
        // 같은 계정이 이미 짓고 있으면 **하루 횟수를 집기 전에** 거절한다 — 두 번 누른 [공유]가 횟수를 둘 태우지 않게.
        // `Retry-After` 는 앞 요청의 정상 경로 상한(연결 + 읽기 — [ShareCardCopyPort.maxWaitMs])을 올림한 초다. 드물게 그보다 오래 걸리면
        // 다시 온 요청이 또 거절될 뿐 하루 횟수는 쓰지 않는다.
        if (!inFlight.add(accountId)) {
            throw RateLimited(
                retryAfterSeconds = ((copier.maxWaitMs + 999) / 1000).coerceAtLeast(1),
                message = "공유 문구를 만들고 있어요. 끝나면 다시 시도해 주세요.",
            )
        }
        val ai = try {
            guardDailyLimit(accountId)
            copier.copy(input)
        } finally {
            inFlight.remove(accountId)
        } ?: return rule // 사유는 어댑터가 남겼다
        // 계약(캡션 1~150자 · 해시태그 ≤10개 · `#` 시작)은 상대 게이트가 먼저 막지만 그쪽 계약에 적혀 있지 않다 — 우리 쪽에서 다시 지킨다.
        // 캡션은 자르지 않는다(문장 중간에서 끊긴 캡션을 내리지 않는다) — 넘으면 규칙 문구다. 태그는 다듬어 앞에서 [MAX_HASHTAGS] 개.
        val caption = ai.caption.trim()
        if (ai.isFallback || caption.isEmpty() || caption.length > MAX_CAPTION) {
            // 상대의 폴백은 지역 하나로 짠 문구라(목적지가 여럿이어도 태그 하나) 우리 규칙 문구가 낫다.
            log.info("공유 문구 AI 답을 쓰지 않고 규칙 문구로 갑니다. tripId={} 폴백={} 캡션길이={}", tripId, ai.isFallback, caption.length)
            return rule
        }
        val hashtags = normalizeTags(ai.hashtags)
        val skipped = days.flatMap { it.visits }.filter { it.skipped }.mapNotNull { surfaces[it.poiId]?.nameKo }
        val visited = shown.map { it.poiName }
        // 캡션은 공유 대조 그대로, 해시태그는 공백을 지우고 본다 — 태그는 공백을 못 담아 "제주 동문시장"이 `#제주동문시장` 으로 나온다.
        // 공유 [HallucinationGate] 의 부분 문자열 대조로는 그것을 못 잡는다(그 게이트는 회고 카드도 쓰므로 여기서 바꾸지 않는다).
        val offending = HallucinationGate.offendingPlaces(caption, skipped, visited) + tagLeaks(hashtags, skipped, visited)
        if (offending.isNotEmpty()) {
            // 강등 지표(ReflectionMetrics)에는 더하지 않는다 — 그 수치는 회고 카드의 환각률이고, AI 를 계속 켤지의 근거다.
            log.warn("공유 문구 AI 가 안 간 장소를 말해 규칙 문구로 갑니다. tripId={} 장소={}", tripId, offending.distinct())
            return rule
        }
        return ShareCardCopy(caption, hashtags, isFallback = false)
    }

    /**
     * 계정당 하루 AI 문구 횟수(TRIP-1411) — [공유]마다 LLM 1회이고 Tomcat 스레드를 AI 응답까지 붙든다. **AI 까지 갈 호출만** 센다
     * (꺼짐·간 곳 없음·404·409 는 세지 않는다). 하루의 경계는 여행지 기준(KST) 자정이다 — 일정 생성 상한(TRIP-1314)과 같다.
     * 상한에 닿으면 규칙 문구로 조용히 낮추지 않고 429 를 낸다 — 앱이 "오늘은 더 못 만든다"를 말할 수 있어야 한다(일정 생성과 같은 판단).
     */
    private fun guardDailyLimit(accountId: UUID) {
        val now = clock.instant()
        val today = now.atZone(TRAVEL_ZONE).toLocalDate()
        if (usage.claim(accountId, today, properties.dailyLimit)) return
        val nextDay = today.plusDays(1).atStartOfDay(TRAVEL_ZONE).toInstant()
        throw RateLimited(
            retryAfterSeconds = Duration.between(now, nextDay).seconds.coerceAtLeast(1),
            message = "오늘 AI 공유 문구 ${properties.dailyLimit}번을 모두 썼어요. 내일 0시부터 다시 만들 수 있어요.",
            errorCode = ErrorCode.SHARE_CARD_DAILY_LIMIT,
        )
    }

    companion object {
        private val log = LoggerFactory.getLogger(ShareCardCopyService::class.java)

        /** 상대 요청의 `kind` — 여행 전체가 재료다. */
        private const val KIND = "TRIP_SUMMARY"

        /** 캡션 상한 — 앱 `validateCaption` 과 같은 단위(UTF-16 코드 유닛, Kotlin `String.length`)다. */
        internal const val MAX_CAPTION = 150
        internal const val MAX_HASHTAGS = 10

        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

        /**
         * 규칙 문구 — 앱이 지금 기기에서 짓는 꼴과 같다: **캡션은 비우고**(TRIP-766 이 문장 시드를 걷어냈다 — 사용자가 쓴다) 목적지마다
         * `#{지역}여행`. 태그는 공백을 못 담아 지우고(앱은 지우지 않는다 — 다어절 지역은 앱 태그가 끊긴다), 앞에서 [MAX_HASHTAGS] 개.
         */
        internal fun ruleCopy(destinations: List<String>): ShareCardCopy = ShareCardCopy(
            caption = "",
            hashtags = destinations.map { "#${it.filterNot(::isTagSpace)}여행" }.distinct().take(MAX_HASHTAGS),
            isFallback = true,
        )

        /**
         * 태그에 들어갈 수 없는 공백 — 앱(ECMAScript `\s`)이 공백으로 보는 것을 전부 지운다. Kotlin `isWhitespace` 는 U+FEFF(BOM)를
         * 공백으로 보지 않는다 — 남기면 계약 `^#\S+$` 를 어기는 태그가 나간다.
         */
        internal fun isTagSpace(c: Char): Boolean = c.isWhitespace() || c == '\uFEFF'

        /** AI 태그 다듬기 — 공백을 지우고, `#` 를 하나만 앞에 두고, 빈 것·중복을 빼고, 앞에서 [MAX_HASHTAGS] 개. */
        internal fun normalizeTags(tags: List<String>): List<String> = tags
            .map { it.filterNot(::isTagSpace).trimStart('#') }
            .filter(String::isNotEmpty)
            .map { "#$it" }
            .distinct()
            .take(MAX_HASHTAGS)

        /**
         * 해시태그가 안 간 곳의 이름을 담는가 — 양쪽 공백을 지우고 대소문자를 무시해 본다. [HallucinationGate] 처럼 **간 곳 이름에 삼켜지는
         * 금지 이름은 뺀다**("카페"를 건너뛰고 "카페 델문도"에 갔으면 `#카페델문도` 는 정당하다).
         */
        internal fun tagLeaks(tags: List<String>, banned: List<String>, visited: List<String>): List<String> {
            fun key(s: String) = s.filterNot(::isTagSpace).lowercase()
            val visitedKeys = visited.map(::key).filter(String::isNotEmpty)
            val bodies = tags.map { key(it.trimStart('#')) }
            return banned.filter { name ->
                val k = key(name)
                k.isNotEmpty() && visitedKeys.none { it.contains(k) } && bodies.any { it.contains(k) }
            }
        }
    }
}

/**
 * @property dailyLimit 계정당 하루 AI 공유 문구 횟수(TRIP-1411). 1 이상 — 0 이면 아무도 AI 문구를 못 받는데, 그건 끄는 스위치
 *   (`trippilot.ai.reflection.mode`)의 일이다.
 */
@ConfigurationProperties(prefix = "trippilot.reflection.share-card")
data class ShareCardCopyProperties(val dailyLimit: Int = 30) {
    init {
        require(dailyLimit >= 1) { "trippilot.reflection.share-card.daily-limit($dailyLimit)는 1 이상이어야 합니다 — 끄려면 AI 모드를 rule 로 두세요." }
    }
}
