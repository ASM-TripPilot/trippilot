package com.trippilot.core.export

import java.util.UUID

/**
 * 내 데이터 내려받기의 **모듈별 기여자**(TRIP-551 · G-U6-3).
 *
 * ## 왜 이 모양인가
 *
 * 내보내기는 계정이 소유한 것 **전부**를 모은다 — 프로필·취향·여행·일정·방문 기록·저장 항목·동의 이력.
 * 이걸 한 모듈이 하려면 그 모듈이 여섯 모듈을 의존해야 하고, 모듈이 하나 늘 때마다 그 목록을 고쳐야 한다.
 * 대신 **각 모듈이 자기 몫을 낸다.** 조립은 `app` 이 한다 — 아웃박스 릴레이가 [OutboxSubscriber] 를
 * 모으는 것과 같은 꼴이다(TRIP-539).
 *
 * 그래서 모듈이 늘어도 내보내기 코드는 그대로다. 반대로 **기여자를 안 만들면 그 모듈 데이터가 조용히
 * 빠진다** — 새 모듈을 만들 때 이 인터페이스를 기억해야 한다.
 */
interface AccountDataContributor {
    /** 응답에서 이 몫이 실릴 자리. 모듈당 하나이며 겹치면 조립이 거부한다. */
    val section: String

    /**
     * 그 계정 것만 낸다. **다른 계정 데이터가 한 건도 섞이면 안 되는 것**이 이 표면의 유일한 안전 요건이다.
     *
     * [limit] 을 넘기면 잘라 내고 [ExportSection.truncated] 를 세운다 — 조용히 자르면 사용자는
     * 받은 파일이 전부인 줄 안다.
     */
    fun export(accountId: UUID, limit: Int): ExportSection
}

/**
 * 한 몫.
 *
 * @property items 자유 형태다 — 내보내기는 **자료 덤프**지 클라이언트가 프로그래밍하는 계약이 아니다.
 *   여기에 타입을 박으면 모듈이 필드를 하나 늘릴 때마다 공용 계약이 흔들린다.
 * @property truncated 상한에 걸려 잘렸는가. **값으로 알린다** — 빈 자리나 침묵으로 두면 사용자가
 *   받은 것이 전부인 줄 안다(INV-4).
 */
data class ExportSection(
    val section: String,
    val items: List<Map<String, Any?>>,
    val truncated: Boolean = false,
) {
    companion object {
        /** 목록을 상한까지 자르고 잘렸는지 함께 담는다. */
        fun of(section: String, all: List<Map<String, Any?>>, limit: Int) =
            ExportSection(section, all.take(limit), truncated = all.size > limit)
    }
}
