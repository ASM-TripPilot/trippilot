package com.trippilot.profile.adapter.`in`.web

import com.fasterxml.jackson.databind.PropertyNamingStrategies
import com.fasterxml.jackson.databind.annotation.JsonNaming
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

/**
 * AI 서비스가 페르소나를 **재조회**하는 경계(TRIP-434 의 선행).
 *
 * ## 왜 봉투가 아니라 조회인가
 *
 * AI 는 BR-U4-07("프롬프트에 들어가는 값은 요청자 권한 하에 재조회한 것만")에 따라 페르소나를
 * `ttl_sec=0` 으로 매 요청 다시 읽는다. 요청 봉투에 실어 보내면 그 값은 **호출자가 준 것**이라
 * 규칙이 배제한다. 그래서 별도 조회 경로가 필요하다.
 *
 * ## 인증
 *
 * `/internal` 하위는 서비스 토큰만 통과한다(TRIP-393) — 사용자 JWT 로는 열리지 않는다.
 * (경로 와일드카드를 주석에 그대로 쓰면 **Kotlin 이 중첩 주석 시작으로 읽어** 파일 끝까지 주석이 된다.
 * 실측으로 컴파일이 깨졌다 — 문장으로 쓴다.)
 * 계정 스코프가 없는 호출이라 사용자 토큰을 흉내 내면 감사 로그의 "누가 했나"가 거짓이 된다.
 * openapi.yaml 에는 싣지 않는다 — 그 파일은 공개 표면(`/api/v1`) 계약이고, 계약 테스트도 거기만 본다.
 *
 * ## 어휘
 *
 * **우리 어휘를 그대로 낸다**(`휴양`·`혼자`·`저가`). 이미 generate 봉투의 `preference_profile` 이
 * 같은 방식이라 필드 이름도 그 스키마에 맞췄다 — AI 는 변환기 하나를 두 자리에 쓴다.
 * 반대로 우리가 AI enum(`REST`·`SOLO`·`LOW`)으로 바꿔 내면, 접기 규칙(`부모님`→?, `럭셔리`→`HIGH`,
 * 동행 다중→단일)의 판단을 우리가 떠안고 AI enum 이 바뀔 때마다 따라 고쳐야 한다.
 *
 * ## 계정 단위다
 *
 * 여기 `companion_types` 는 **계정의 평소 성향**(다중 선택)이지 특정 여행의 동행이 아니다.
 * 이 여행의 실제 동행은 AI 가 이미 생성 봉투의 `trip_context.companion_type` 으로 받는다.
 */
@RestController
@RequestMapping("/internal/users")
class PersonaInternalController(
    private val preferences: PreferenceFacade,
) {
    /**
     * 계정의 취향 스냅숏. 미설정 축은 '선택 없음'을 그대로 낸다 — 중립 기본값을 주입하지 않는다.
     * 소프트 가중치·중립 처리는 AI 지능이 소유한다(판단/검증 분리, INV-2).
     *
     * ⚠ **"계정 없음"과 "취향 미설정"을 구분하지 못한다.** [PreferenceFacade] 가 미설정 계정에도
     * 빈 스냅숏을 돌려주는 계약이라 그렇다. 오타 난 UUID 는 오류가 아니라 중립 페르소나로 보인다.
     * 구분하려면 auth 에 계정 존재 퍼사드를 새로 열어야 해서 이 노드 범위 밖으로 뒀다.
     */
    @GetMapping("/{accountId}/persona")
    fun persona(@PathVariable accountId: String): PersonaResponse =
        PersonaResponse.from(preferences.findPreferences(parseAccountId(accountId)))

    /**
     * UUID 를 직접 받지 않고 문자열로 받아 파싱한다 — Spring 의 타입 변환 실패는
     * `MethodArgumentTypeMismatchException` 이고 전역 핸들러가 그것을 모른다(=500).
     * 호출자가 이상한 값을 보낸 것을 서버 장애로 알리면 AI 쪽이 자기 버그를 우리 장애로 읽는다.
     */
    private fun parseAccountId(raw: String): UUID =
        runCatching { UUID.fromString(raw) }
            .getOrElse { throw ValidationFailed(listOf(FieldError("accountId", "UUID 형식이 아닙니다"))) }
}

/**
 * 페르소나 응답 — AI 와이어의 `PreferenceProfileSchema` 와 **같은 필드 이름**(snake_case).
 * 이름이 갈리면 AI 가 같은 값에 대해 변환기를 둘 두게 되고, 한쪽만 고쳐 어긋난다.
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class PersonaResponse(
    val styles: List<String>,
    val activities: List<String>,
    val foodTastes: List<String>,
    val transportModes: List<String>,
    val pace: String?,
    val companionTypes: List<String>,
    val petFriendly: Boolean,
    val budgetTier: String?,
) {
    companion object {
        fun from(s: PreferenceSnapshot) = PersonaResponse(
            styles = s.styles,
            activities = s.activities,
            foodTastes = s.foodTastes,
            transportModes = s.transportModes,
            pace = s.pace,
            companionTypes = s.companionTypes,
            petFriendly = s.petFriendly,
            budgetTier = s.budgetTier,
        )
    }
}
