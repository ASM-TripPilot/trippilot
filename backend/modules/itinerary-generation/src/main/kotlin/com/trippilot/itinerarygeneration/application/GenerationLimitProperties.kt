package com.trippilot.itinerarygeneration.application

import org.springframework.boot.context.properties.ConfigurationProperties
import java.util.UUID

/**
 * 계정당 **하루 AI 일정 생성 횟수** 상한(TRIP-1314).
 *
 * 생성 한 번이 LLM 을 12~22회 부른다. 다른 여행의 동시 생성은 막지만(TRIP-403) **같은 여행의 재생성은
 * 탈출구라 열려 있어**, 연타가 그대로 비용에 곱해졌다. 프론트 임시 카운터(TRIP-1268)는 클라이언트가
 * 지우면 끝이라 방어가 아니다 — 업무 규칙의 권한은 서버에 있다.
 *
 * 설정으로 뺀 이유: **값의 근거가 아직 없다.** 계정별 사용 분포를 볼 수단(TRIP-1312)이 나오기 전이라
 * 10 으로 시작하고(2026-10-12 사용자 결정), 관측이 나오면 돌린다.
 *
 * [exemptAccountIds] 는 상한을 받지 않는 **개발자 계정**이다 — 생성을 반복해 보는 것이 일이라 상한이
 * QA 를 막는다. 계정 ID 는 환경(DB)마다 달라 환경별로 따로 넣는다.
 *
 * 푸시 상한(`PushRateLimits`)과 달리 **하드 상한**이다 — 그쪽은 넘겨도 알림함에 남지만 이쪽은 넘긴
 * 요청이 그대로 비용이다.
 */
@ConfigurationProperties(prefix = "trippilot.itinerary.generation-limit")
data class GenerationLimitProperties(
    val daily: Int = 10,
    // ponytail: 설정 목록이라 추가·삭제에 재배포가 든다. 개발자 몇 명이 전부라 테이블·관리 API 는
    // 안 만들었다 — 재배포 없이 바꿔야 하거나 대상이 팀 밖으로 넓어지면 계정 플래그로 옮긴다.
    val exemptAccountIds: Set<UUID> = emptySet(),
) {
    init {
        // 0 이하면 아무도 일정을 못 만든다 — 끄려는 의도였다면 조용히 전면 차단이 된다.
        require(daily >= 1) { "하루 생성 상한($daily)은 1 이상이어야 합니다." }
    }
}
