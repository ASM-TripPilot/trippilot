package com.trippilot.profile.adapter.`in`.web

import com.trippilot.profile.application.AccountSettingService
import com.trippilot.profile.application.AccountSettingsView
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal

/**
 * 계정 단위 앱 설정(`l05` · BR-U6-33).
 *
 * `/me/preferences` 와 나란히 두되 **섞지 않는다** — 취향은 여행 생성 시 동결되고(preferenceSnapshot)
 * 설정은 지금의 상태다. 섞으면 "제휴 안내 다시 안 보기"가 여행 이력에 박힌다.
 */
@RestController
@RequestMapping("/api/v1/me/settings")
class AccountSettingController(private val service: AccountSettingService) {

    /** 저장한 적 없으면 기본값으로 온다 — 404 가 아니다(첫 진입에서 화면이 설정을 그려야 한다). */
    @GetMapping
    fun get(principal: Principal): AccountSettingsResponse =
        AccountSettingsResponse.from(service.of(principal.accountId()))

    /** **준 것만** 바꾼다. 생략한 필드는 그대로다 — null 을 "끄기"로 읽으면 다른 토글이 조용히 꺼진다. */
    @PatchMapping
    fun patch(principal: Principal, @RequestBody request: UpdateAccountSettingsRequest): AccountSettingsResponse =
        AccountSettingsResponse.from(service.patch(principal.accountId(), request.affiliateNoticeDismissed))
}

/** [affiliateNoticeDismissed] 생략 = 변경 없음. false 를 보내면 "다시 보기"로 되돌린다(l05 토글). */
data class UpdateAccountSettingsRequest(val affiliateNoticeDismissed: Boolean? = null)

data class AccountSettingsResponse(
    /** true 면 외부 이동 시 제휴 안내를 띄우지 않는다(BR-U6-33). 계정 단위라 기기가 달라도 같다. */
    val affiliateNoticeDismissed: Boolean,
) {
    companion object {
        fun from(v: AccountSettingsView) = AccountSettingsResponse(v.affiliateNoticeDismissed)
    }
}
