package com.trippilot.archive.adapter.`in`.web

import com.trippilot.archive.application.AddVisitPhoto
import com.trippilot.archive.application.VisitRecordService
import com.trippilot.archive.domain.VisitMemo
import com.trippilot.archive.domain.VisitPhotoMeta
import com.trippilot.core.error.AuthenticationRequired
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.util.UUID

/**
 * 방문 기록 — 사진 **메타**와 메모(`j04`). 여행 하위 리소스. 소유 스코프(타 계정 404).
 *
 * **업로드 엔드포인트가 아니다.** 바이너리를 받는 경로는 없고 만들지도 않는다(INV-U5-03) —
 * 화면이 기기 로컬 자산을 직접 렌더하고 서버는 연결만 안다.
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/visits/{visitCheckId}")
class VisitRecordController(private val service: VisitRecordService) {

    @PostMapping("/photos")
    @ResponseStatus(HttpStatus.CREATED)
    fun addPhoto(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable visitCheckId: UUID,
        @RequestBody request: AddPhotoRequest,
    ): VisitPhotoResponse = VisitPhotoResponse.from(
        service.addPhoto(principal.accountId(), tripId, visitCheckId, request.toCommand()),
    )

    @GetMapping("/photos")
    fun listPhotos(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable visitCheckId: UUID,
    ): VisitPhotoListResponse {
        val items = service.listPhotos(principal.accountId(), tripId, visitCheckId).map { VisitPhotoResponse.from(it) }
        // 개수를 함께 준다 — 목록을 세지 않고도 "몇 장인가"를 쓰는 소비자가 있다(AI 컨텍스트).
        return VisitPhotoListResponse(items, items.size)
    }

    @DeleteMapping("/photos/{visitPhotoMetaId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun removePhoto(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable visitCheckId: UUID,
        @PathVariable visitPhotoMetaId: UUID,
    ) = service.removePhoto(principal.accountId(), tripId, visitCheckId, visitPhotoMetaId)

    @PutMapping("/photos/order")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun reorderPhotos(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable visitCheckId: UUID,
        @RequestBody request: ReorderPhotosRequest,
    ) = service.reorderPhotos(principal.accountId(), tripId, visitCheckId, request.orderedIds)

    @PutMapping("/memo")
    fun putMemo(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable visitCheckId: UUID,
        @RequestBody request: PutMemoRequest,
    ): VisitMemoResponse =
        VisitMemoResponse.from(service.putMemo(principal.accountId(), tripId, visitCheckId, request.text))

    // 메모 **조회·삭제 경로는 열지 않는다.** 티켓 API 목록에 없고, 읽기 표면(`j02` 3종 비교)은
    // TRIP-544 가 소유한다. 쓰기 응답이 저장된 메모를 그대로 돌려주므로 편집 흐름은 이것으로 닫힌다.
    // 서비스에는 조회·삭제가 있다 — TRIP-544 와 계정 파기가 그것을 쓴다.
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }

/**
 * 사진 메타 등록 요청.
 *
 * [exifLat]·[exifLng] 는 **보내도 위치 동의가 없으면 저장되지 않는다**(INV-U5-04) — 거부가 아니라
 * 무시다. 거부로 만들면 클라이언트가 동의 상태를 먼저 알아야 하고, 그 사본이 어긋나는 순간 등록이 막힌다.
 */
data class AddPhotoRequest(
    @field:NotBlank @field:Size(max = VisitPhotoMeta.ASSET_ID_MAX) val localAssetId: String,
    @field:NotBlank @field:Size(max = VisitPhotoMeta.DEVICE_ID_MAX) val deviceId: String,
    val takenAt: Instant? = null,
    val exifLat: Double? = null,
    val exifLng: Double? = null,
    val sortOrder: Int? = null,
) {
    fun toCommand() = AddVisitPhoto(localAssetId, deviceId, takenAt, exifLat, exifLng, sortOrder)
}

/** 그 방문 사진 **전부**를 한 번씩 담아야 한다 — 부분 목록은 나머지와 순서가 겹친다. */
data class ReorderPhotosRequest(val orderedIds: List<UUID>)

data class PutMemoRequest(
    @field:NotBlank @field:Size(max = VisitMemo.TEXT_MAX) val text: String,
)

data class VisitPhotoListResponse(val items: List<VisitPhotoResponse>, val count: Int)

/**
 * 사진 메타의 웹 표현.
 *
 * [deviceId] 를 내보내는 이유는 화면이 **다른 기기에서 찍은 사진**을 구분해야 하기 때문이다(BR-U5-15) —
 * 기기가 바뀌면 자산은 이관되지 않고 메타만 남는다.
 */
data class VisitPhotoResponse(
    val visitPhotoMetaId: UUID,
    val localAssetId: String,
    val deviceId: String,
    val takenAt: Instant?,
    /** 위치 동의가 없으면 null — 요청이 좌표를 실어 보냈어도 그렇다. */
    val exifLat: Double?,
    val exifLng: Double?,
    val sortOrder: Int,
) {
    companion object {
        fun from(p: VisitPhotoMeta) = VisitPhotoResponse(
            p.visitPhotoMetaId, p.localAssetId, p.deviceId, p.takenAt, p.exifLat, p.exifLng, p.sortOrder,
        )
    }
}

data class VisitMemoResponse(val text: String, val updatedAt: Instant) {
    companion object {
        fun from(m: VisitMemo) = VisitMemoResponse(m.text, m.updatedAt)
    }
}
