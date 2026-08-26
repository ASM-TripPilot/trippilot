package com.trippilot.notification.domain

/**
 * 푸시 발송 경계(`PushPort` ← `ExpoPushAdapter`, DEC-U6-3).
 *
 * "하나의 외부 API = 하나의 소유 모듈 = 하나의 어댑터 포트" 규약을 따른다. 도메인은 Expo 를 모른다 —
 * 여기 있는 것은 **토큰에 문구를 보낸다**와 **그 결과가 무엇이었나**뿐이다.
 *
 * 실패를 예외로 올리지 않고 **영수증으로 돌려주는** 이유는, 다기기 발송에서 한 토큰의 실패가
 * 나머지 토큰의 발송을 취소하면 안 되기 때문이다(INV-U6-06).
 */
interface PushPort {
    /** 토큰마다 하나씩, **입력과 같은 수의** 영수증을 돌려준다. */
    fun send(tokens: List<String>, message: PushMessage): List<PushReceipt>
}

/**
 * 보낼 문구. 알림함에 이미 적재된 내용과 같다 — 푸시는 **즉시성 보조 수단**이지 다른 내용을 나르는
 * 통로가 아니다(BR-U6-12).
 */
data class PushMessage(
    val title: String,
    val body: String,
    /** 탭했을 때 어디로 갈지. 알림함 행의 `actionType`·`actionPayload` 를 그대로 싣는다. */
    val data: Map<String, String> = emptyMap(),
)

/** 토큰 한 건의 결과. */
data class PushReceipt(val token: String, val status: PushStatus, val reason: String? = null)

enum class PushStatus {
    SENT,

    /**
     * 그 기기가 더 이상 이 토큰을 쓰지 않는다 — 앱 삭제·재설치·토큰 만료.
     * **즉시 무효화한다**(INV-U6-07 · BR-U6-37). 계속 쏘면 레이트리밋을 먹는다.
     */
    DEVICE_NOT_REGISTERED,

    /** 그 밖의 실패. 재시도 대상이 아니라 **기록 대상**이다(BR-U6-38) — 인앱함에는 이미 있다. */
    FAILED,
}
