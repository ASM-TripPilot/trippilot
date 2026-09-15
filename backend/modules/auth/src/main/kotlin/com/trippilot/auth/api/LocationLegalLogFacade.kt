package com.trippilot.auth.api

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
}

/**
 * 이 파사드가 덮는 것은 **수집(`COLLECTION`)뿐이다.** `event_type` 에는 `USE`·`PROVISION` 도 있고
 * 법은 그 둘도 확인자료로 요구하지만, **아직 해당하는 동작이 없다** — 저장된 좌표를 읽는 곳은
 * 자기 응답으로 돌려주는 조회 하나뿐이고 외부(AI 등)로 나가는 경로는 없다(2026-09-14 실측).
 * 좌표를 쓰거나 내보내는 기능이 생기면 **그 기능과 같은 PR 에서** 이 파사드에 대응 메서드를 연다.
 */

/** 위치를 모은 경로. 닫힌 집합이라 로그 조회가 문자열 매칭에 기대지 않는다. */
enum class LocationCollectionSource {
    /** 사진에 박혀 온 EXIF 좌표(V2.33 `visit_photo_meta`). */
    PHOTO_EXIF,
}
