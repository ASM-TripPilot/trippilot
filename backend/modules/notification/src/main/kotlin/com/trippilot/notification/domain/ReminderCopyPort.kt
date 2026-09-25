package com.trippilot.notification.domain

import java.time.LocalDate

/**
 * 리마인드 문구를 AI 에게 받는 경계(TRIP-836 · `POST /ai/v1/notification/copies`).
 *
 * ## 언제 부르나 — 적재할 때 한 번
 *
 * 예약을 적재하는 시점에 받아 두고 발화 때 꺼내 쓴다. 발화 시점에 부르면 (가) 발화가 상대 지연에
 * 묶이고 (나) 리마인드 수만큼 호출이 늘며 (다) 상대가 죽은 밤에 알림이 통째로 늦는다.
 * 적재는 아웃박스 릴레이(배경)에서 돌므로 사용자 대기에 걸리지 않는다.
 *
 * ## 못 받는 것이 정상 경로다
 *
 * 안 켠 환경·상대 장애·`degraded` 응답이 전부 "못 받음"이고, 그때는 **상수 문구로 간다**(INV-4).
 * 그래서 이 포트는 **예외를 던지지 않고 빈 결과를 돌려준다** — 문구를 못 받았다고 예약 적재가
 * 실패하면 리마인드가 통째로 사라지는데, 그건 문구가 밋밋한 것보다 훨씬 나쁘다.
 *
 * ## 맞물림은 [ReminderCopyRequest.scheduleKey] 하나다
 *
 * 상대는 요청에 실린 키를 응답에 그대로 돌려준다. 우리 예약 행과 같은 값이어야 문구가 제자리에
 * 붙는다 — 슬롯키(`{date}#{poiId}`)와는 **다른 축**이라 섞지 않는다.
 */
interface ReminderCopyPort {

    /** 켜져 있는가. 꺼져 있으면 호출측이 입력 조립조차 하지 않는다. */
    val enabled: Boolean

    /**
     * 받은 문구를 `scheduleKey → 문구` 로 돌려준다. **못 받은 항목은 키가 없다**(빈 값이 아니라).
     * 전부 실패하면 빈 맵이다.
     */
    fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>): Map<String, ReminderCopy>
}

/**
 * 문구를 받고 싶은 예약 하나.
 *
 * @param scheduleKey 응답과 맞물리는 키. 예약을 유일하게 가리켜야 한다.
 * @param date **문구가 말하는 날**이다 — 알림이 울리는 날이 아니다. `TRIP_DAY` 는 둘이 같지만
 *   `TRIP_PRE` 는 하루 전에 울리면서 *"내일은 …"* 을 말하므로 **여행 첫날**이 들어간다.
 *   상대 프롬프트가 `[날짜]` 와 `[오늘 일정]` 을 나란히 놓으므로 둘이 어긋나면 문구가 딴 날을 말한다.
 * @param slots 그 날 무엇을 가는지(방문 순서) — 문구의 재료다. **비우면 상대가 없는 사실을 지어낸다**
 *   (실측: 두 종류 다 "일정이 없으니…" 로 답했다). 그래서 비면 어댑터가 아예 묻지 않는다.
 */
data class ReminderCopyRequest(
    val scheduleKey: String,
    val kind: NotificationKind,
    val date: LocalDate,
    val slots: List<ReminderSlot> = emptyList(),
)

/**
 * 문구 재료 한 칸.
 *
 * [category] 는 **경계 코드**(`FOOD`·`CAFE`)다. 상대 프롬프트가 `"장소 · 카테고리"` 로 렌더하는데
 * 사전이 코드를 키로 쓴다 — 한글(`맛집`)을 보내면 **사전에 없어 조용히 이름만 렌더된다**.
 * 터지지 않고 효과만 사라지는 종류라, 값이 흐르는지는 경계 테스트가 아니라 여기 주석이 지킨다.
 * 모르면 null 이고, 그때 상대는 이름만 쓴다.
 */
data class ReminderSlot(val name: String, val category: String? = null)

/** 받은 문구. 둘 다 있어야 쓴다 — 한쪽만 쓰면 제목과 본문이 따로 논다. */
data class ReminderCopy(val title: String, val body: String)
