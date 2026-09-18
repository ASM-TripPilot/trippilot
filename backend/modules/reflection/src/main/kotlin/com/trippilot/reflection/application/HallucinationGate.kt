package com.trippilot.reflection.application

/**
 * 환각 대조(BR-U5-31) — **안 간 곳이 회고에 적히는 것**을 막는다.
 *
 * ## 왜 이 검사만 따로 있나
 *
 * 회고에서 환각은 일반적인 LLM 오류보다 무겁다. 사용자가 **자기가 겪은 하루**를 읽는 화면이라,
 * 문장이 밋밋한 것은 실망이지만 **안 간 카페가 내 회고에 적혀 있는 것은 기록을 못 믿게 되는 일**이다.
 * "AI 가 실패하면 규칙 카드로 내려가니 켜도 잃을 게 없다"는 정확하지 않다 — 잃을 게 없는 쪽은
 * 실패이고, 위험한 쪽은 **그럴듯하게 성공**하는 경우다.
 *
 * ## 무엇을 대조하는가 — 정본 이탈(근거 포함)
 *
 * 티켓은 "장면에 등장하는 장소가 그날 방문 목록에 있는지" 보라고 했지만, **상대 계약에 장소 필드가
 * 없다**(`SceneSchema` = `layout`·`caption`·`photo_slot`·`source_event`). 장소는 문장 안에 녹아 있어
 * "이 토큰이 장소인가"를 우리가 판별할 수단이 없다 — 그걸 하려면 NER 이 필요하고 그건 이 티켓 밖이다.
 *
 * 그래서 **반대로 판정한다**: 우리가 **안 갔다고 확실히 아는 이름**(건너뛴 방문지)이 카드에 나오면
 * 환각으로 본다. 오탐이 거의 없고(확실히 안 간 곳이다) 실제 위험을 정확히 겨눈다 — 티켓이 말한
 * "느슨한 쪽에서 시작하고 강등률을 보고 조인다"에 맞는 출발점이다.
 *
 * ## 구조를 읽지 않는다
 *
 * `scenes[].caption` 경로를 파고들지 않고 **payload 문자열 전체**에서 찾는다. 카드 내부를 모델링하지
 * 않는다는 원칙(DEC-U5-14)을 지키면서, 상대가 템플릿 구조를 바꿔도 검사가 조용히 무력화되지 않는다.
 * 해시태그에 섞여 들어와도 같이 잡힌다 — 그것도 환각이다.
 */
object HallucinationGate {

    /**
     * 카드가 **안 간 장소**를 말하고 있으면 그 이름들을 돌려준다. 비어 있으면 통과.
     *
     * @param bannedPlaceNames 그날 **가지 않은** 장소 이름(건너뛴 방문지). 빈 이름은 무시한다 —
     *   빈 문자열은 모든 문자열에 포함돼 전량 강등을 부른다.
     */
    fun offendingPlaces(
        payload: String,
        bannedPlaceNames: Collection<String>,
        visitedPlaceNames: Collection<String>,
    ): List<String> {
        val visited = visitedPlaceNames.map { it.trim() }.filter { it.isNotEmpty() }
        return bannedPlaceNames.asSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
            // **방문한 이름에 삼켜지는 금지 이름은 뺀다.** 아래 판정이 부분 문자열이라, 건너뛴 곳이
            // "카페"이고 실제로 간 곳이 "카페 델문도"면 멀쩡한 카드가 강등된다. 한국 지명에 짧은
            // 일반명(공항·시장·해변)이 흔해 드문 조합이 아니다.
            //
            // 이름이 **정확히 같은** 경우(동명 POI 둘, 하나는 방문 하나는 건너뜀)도 여기서 빠진다.
            // 어느 쪽을 말하는지 판별할 수단이 없으므로 강등하지 않는 편이 맞다 — 오탐은 조용히
            // 안전한 쪽(규칙 카드)으로 떨어져 증상이 안 보이는데, 그 사이 강등 지표는
            // "AI 가 환각한다"로 읽힌다. 그 수치가 AI 를 계속 켤지 판단하는 근거라 오염되면 안 된다.
            .filterNot { banned -> visited.any { it.contains(banned) } }
            .filter { payload.contains(it) }
            .toList()
    }
}
