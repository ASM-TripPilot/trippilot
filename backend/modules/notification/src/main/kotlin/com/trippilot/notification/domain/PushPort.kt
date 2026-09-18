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
    /**
     * **실제로 기기까지 보내는가.** 기본 발송기는 아무 데도 안 보내면서 성공을 보고하는데
     * (그 판단 자체는 옳다 — 실패로 보고하면 진짜 실패가 묻힌다), 그 상태에서 발송 지표가
     * "성공률 100%" 를 그린다. 운영에서 그 그래프를 보면 **푸시가 잘 나가고 있다고 읽는다.**
     *
     * 그래서 지표가 "보냈다"와 "보낸 척했다"를 갈라야 한다. 기본값을 두지 않는다 — 새 발송기가
     * 실수로 "실발송"이 되는 쪽이 반대보다 위험하다.
     */
    val deliversExternally: Boolean

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
    /**
     * 이 알림이 지금 울려야 하는가([NotificationKind.urgency]).
     *
     * **기본값을 두지 않는다.** 처음엔 `ACTIVE` 를 기본으로 뒀는데, 역검증에서 발송 지점이 이 값을
     * 안 실어도 아무 테스트가 깨지지 않았다 — 기본값이 "말하지 않은 것"과 "보통이라고 말한 것"을
     * 같게 만든 것이다. 이 리포가 세 번 겪은 형태라(anti-patterns: 기본값이 거짓말한다) 지웠다.
     */
    val urgency: PushUrgency,
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
