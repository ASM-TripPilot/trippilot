package com.trippilot.auth.api

import java.time.Instant
import java.util.UUID

/**
 * 위치 법정 로그 기록(C1 auth) — 공개 계약(R1, `..api..`).
 *
 * `location_legal_log` 는 위치정보 **수집·이용·제공 사실 확인자료**다(V1.3, append-only). 표는
 * "위치를 모으면 사실을 남긴다"는 전제로 만들어졌는데, 정작 위치를 보관하는 모듈(사진 EXIF 좌표)이
 * 이 로그를 한 번도 부르지 않고 있었다(2026-09-12 실측 0건).
 *
 * [LocationConsentFacade] 와 나눠 두는 이유는 관심사가 다르기 때문이다 — 그쪽은 **"받아도 되나"를 묻고**
 * 이쪽은 **"받았다는 사실을 남긴다"**. 묻는 시점과 남기는 시점이 다르고(판정 → 저장 성공 후),
 * 한쪽만 필요한 소비자가 대부분이다.
 */
interface LocationLegalLogFacade {
    /**
     * 위치정보를 **실제로 저장했을 때** 수집 사실을 남긴다.
     *
     * 동의가 없어 좌표를 버린 경우는 부르지 않는다 — 그건 수집이 아니다. 그래서 호출 지점은
     * 저장 **결과**를 보고 판정해야 한다(요청에 좌표가 실려 왔는지가 아니라).
     *
     * 호출자의 트랜잭션에 **참여한다**(분리하지 않는다). 사진 저장이 롤백되면 수집도 없었던 것이므로
     * 로그도 함께 사라지는 것이 맞다 — append-only 는 "지우지 않는다"이지 "틀린 기록도 남긴다"가 아니다.
     *
     * @param subjectId 대상 식별자(예: `visit_photo_meta_id`). **원시 좌표는 넘기지 않는다** —
     *   이 표는 사실 확인자료이고 좌표 자체를 또 보관하면 파기 대상이 한 곳 더 생긴다(V1.3 규약).
     */
    fun recordCollection(accountId: UUID, source: LocationCollectionSource, subjectId: UUID)

    /**
     * 저장된 위치정보를 **실제로 지웠을 때** 파기 사실을 남긴다(INV-L4).
     *
     * [scope] 를 지운 쪽이 적는 이유: 무엇을 얼마나 지웠는지는 **소유 모듈만 안다.** 철회를 받은
     * auth 가 대신 `gps_track` 하나로 뭉쳐 적으면 기록과 실제가 어긋나고, 나중에 "EXIF 는 지웠나"를
     * 로그로 답할 수 없다.
     *
     * @param purgedCount 지운 건수. 0 이면 부르지 않는다 — 지울 것이 없었던 것과 지웠다는 기록은 다르다.
     */
    fun recordPurge(accountId: UUID, scope: LocationPurgeScope, purgedCount: Int)

    /**
     * 위치 **이용** 구간의 시작·끝(U10 지오펜스 무장, BR-U10-47) — `USE` 1건. 자동 도착 1건마다가 아니라 **구간 단위**다.
     * 기기가 좌표를 서버로 보내지 않으므로(DEC-U10-8) 사실은 "언제부터 언제까지 무장했나"뿐이다.
     *
     * @param endReason END 일 때만. @param regionCount END 일 때만 — 무장했던 리전 수.
     */
    fun recordUseInterval(
        accountId: UUID, purpose: LocationUsePurpose, intervalId: UUID, tripId: UUID,
        phase: LocationIntervalPhase, at: Instant, endReason: String? = null, regionCount: Int? = null,
    )

    /**
     * 기기 안에서의 위치 **수집** 구간(U10 경로 기록 세션)의 시작·끝 — `COLLECTION` 1건(`scope=DEVICE`). 표본은 기기에만
     * 있고, 서버에 실제로 저장한 순간은 [recordCollection] 이 따로 남긴다.
     */
    fun recordCollectionInterval(
        accountId: UUID, source: LocationCollectionSource, intervalId: UUID, tripId: UUID,
        phase: LocationIntervalPhase, at: Instant, endReason: String? = null, pointCount: Int? = null,
    )
}

/** 위치 이용 목적(U10). 닫힌 집합 — 법정 로그 조회가 문자열 매칭에 기대지 않는다. */
enum class LocationUsePurpose {
    /** 지오펜스로 일정 장소 도착·이탈을 판정해 방문 실적을 자동으로 남긴다. */
    GEOFENCE_AUTO_VISIT,
}

/** 구간 보고의 단계. */
enum class LocationIntervalPhase { START, END }

/** 파기 대상 범위. `gps_track` 하나로 뭉치지 않는다 — 실제 지운 것과 기록이 어긋나면 안 된다. */
enum class LocationPurgeScope {
    /** 사진에 딸려 저장됐던 EXIF 좌표(`visit_photo_meta.exif_lat/lng`). */
    PHOTO_EXIF,

    /** 재계획 세션에 저장됐던 기준점 좌표(`replan_session.origin_lat/lng`, TRIP-992). */
    REPLAN_ORIGIN,
}

/**
 * 이 파사드가 덮는 것은 **수집(`COLLECTION`)과 이용(`USE`)이다.** `USE` 는 U10 지오펜스 무장 구간과 함께 열었다
 * ([LocationLegalLogFacade.recordUseInterval]). `PROVISION`(외부 제공)은 **아직 해당하는 동작이 없다** — 좌표가
 * 외부(AI 등)로 나가는 경로는 없다(2026-09-14 실측). 생기면 **그 기능과 같은 PR 에서** 대응 메서드를 연다.
 */

/** 위치를 모은 경로. 닫힌 집합이라 로그 조회가 문자열 매칭에 기대지 않는다. */
enum class LocationCollectionSource {
    /** 사진에 박혀 온 EXIF 좌표(V2.33 `visit_photo_meta`). */
    PHOTO_EXIF,

    /** 재계획 요청에 실려 온 기준점 좌표 — GPS·수동 핀(V2.17 `replan_session`, TRIP-992). */
    REPLAN_ORIGIN,

    /** U10 이동 경로 기록 — 기기 안 표본 수집 구간과, 하루치 경로의 서버 저장. */
    ROUTE_TRACE,
}
