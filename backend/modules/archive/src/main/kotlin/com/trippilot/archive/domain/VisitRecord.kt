package com.trippilot.archive.domain

import java.time.Instant
import java.util.UUID

/**
 * 방문에 붙는 사진 **메타**(U5 정본 §3 · BR-U5-11).
 *
 * **INV-U5-03 — 서버는 사진 바이너리를 갖지 않는다.** 여기 있는 것은 "어느 기기의 어느 자산이 어느 방문에
 * 붙었나"뿐이고, 화면은 그 식별자로 기기 로컬 자산을 직접 연다. 그래서 `storageKey`·`url` 같은 필드가
 * 없는 것이 아니라 **있으면 안 된다** — 한 번 만들면 다음 사이클이 채운다(DEC-U5-9).
 *
 * @property localAssetId 기기 안에서만 뜻이 있는 값(iOS PHAsset · Android MediaStore).
 * @property deviceId 기기가 바뀌면 사진은 이관되지 않고 **메타만 남는다**(BR-U5-15) — 그 판정의 근거다.
 * @property exifLat 위치 동의(L3)가 없으면 **null 이다**(INV-U5-04). 요청이 좌표를 실어 보내도 서버가 버린다.
 */
data class VisitPhotoMeta(
    val visitPhotoMetaId: UUID,
    val visitCheckId: UUID,
    val localAssetId: String,
    val deviceId: String,
    val takenAt: Instant?,
    val exifLat: Double?,
    val exifLng: Double?,
    val sortOrder: Int,
) {
    init {
        require(localAssetId.isNotBlank() && localAssetId.length <= ASSET_ID_MAX) {
            "자산 식별자는 1~$ASSET_ID_MAX 자여야 합니다."
        }
        require(deviceId.isNotBlank() && deviceId.length <= DEVICE_ID_MAX) {
            "기기 식별자는 1~$DEVICE_ID_MAX 자여야 합니다."
        }
        // 좌표는 둘 다 있거나 둘 다 없다. 하나만 있으면 지도에 찍을 수 없는 반쪽 값이 남는다.
        require((exifLat == null) == (exifLng == null)) { "좌표는 위도·경도가 함께 있어야 합니다." }
        require(exifLat == null || exifLat in -90.0..90.0) { "위도 범위를 벗어났습니다." }
        require(exifLng == null || exifLng in -180.0..180.0) { "경도 범위를 벗어났습니다." }
    }

    companion object {
        /** `visit_photo_meta.local_asset_id` 컬럼 상한과 같아야 한다 — 갈리면 저장 시점에 22001 로 터진다. */
        const val ASSET_ID_MAX = 200
        const val DEVICE_ID_MAX = 64

        /**
         * 새 메타. [gpsRecordingOptIn] 이 거짓이면 **좌표를 받지 않는다**(INV-U5-04).
         *
         * 판정을 여기 두는 이유는 경로가 늘어도 한 곳만 지키면 되기 때문이다 — 컨트롤러에서 걸면
         * 다음 진입점(일괄 등록·동기화)이 생길 때 그 자리가 비어도 아무도 모른다.
         */
        fun attach(
            visitCheckId: UUID,
            localAssetId: String,
            deviceId: String,
            takenAt: Instant?,
            exifLat: Double?,
            exifLng: Double?,
            sortOrder: Int,
            gpsRecordingOptIn: Boolean,
        ) = VisitPhotoMeta(
            visitPhotoMetaId = UUID.randomUUID(),
            visitCheckId = visitCheckId,
            localAssetId = localAssetId,
            deviceId = deviceId,
            takenAt = takenAt,
            exifLat = exifLat.takeIf { gpsRecordingOptIn },
            exifLng = exifLng.takeIf { gpsRecordingOptIn },
            sortOrder = sortOrder,
        )
    }
}

/**
 * 방문 메모 — 한 방문에 **한 개**(BR-U5-13). 물리적으로도 `visit_check_id` 가 PK 라 두 개가 될 수 없다.
 *
 * 메모는 사진과 무관하게 남는다(INV-U5-05) — 자산을 못 열어도 감상은 남아야 한다.
 */
data class VisitMemo(
    val visitCheckId: UUID,
    val text: String,
    val updatedAt: Instant,
) {
    init {
        require(text.isNotBlank() && text.length <= TEXT_MAX) { "메모는 1~$TEXT_MAX 자여야 합니다." }
    }

    companion object {
        /** `visit_memo.text` 컬럼 상한과 같아야 한다. */
        const val TEXT_MAX = 2000
    }
}

/** 사진 메타 영속 포트. */
interface VisitPhotoMetaRepository {
    fun save(photo: VisitPhotoMeta): VisitPhotoMeta

    /** 정렬 순서대로. 같은 순서는 등록 순으로 갈라 결정론을 유지한다. */
    fun findByVisit(visitCheckId: UUID): List<VisitPhotoMeta>

    fun findById(visitPhotoMetaId: UUID): VisitPhotoMeta?

    fun delete(visitPhotoMetaId: UUID): Boolean

    /** 여러 방문의 사진 **개수**. 목록 화면과 AI 컨텍스트 조립이 이것만 필요로 한다. */
    fun countByVisits(visitCheckIds: Collection<UUID>): Map<UUID, Int>
}

/** 메모 영속 포트. */
interface VisitMemoRepository {
    /** 있으면 덮고 없으면 만든다 — 한 방문에 한 개라 upsert 가 곧 계약이다. */
    fun upsert(memo: VisitMemo): VisitMemo

    fun find(visitCheckId: UUID): VisitMemo?

    /**
     * 메모가 **있는** 방문들. 기록 화면은 본문이 아니라 유무만 쓰므로 한 번에 묻는다 —
     * 방문마다 따로 조회하면 하루치를 그리는 데 N번 왕복한다.
     */
    fun findVisitsWithMemo(visitCheckIds: Collection<UUID>): Set<UUID>

    fun delete(visitCheckId: UUID): Boolean
}
