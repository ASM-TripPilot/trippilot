package com.trippilot.app

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.io.File

/**
 * **배포 경로마다 숙소 콘텐츠 경로가 다르면 안 된다.**
 *
 * ## 왜 있나 — 실제로 갈려 있었다
 *
 * 2026-09-22 실측으로 셋이 제각각이었다. EKS 차트는 `db`(12,782곳), 로컬 k8s 매니페스트는
 * **아예 없음**(→ 기본 stub, 제주 5곳), compose 인라인 기본값도 stub.
 *
 * 갈려 있으면 **같은 매니페스트를 읽고도 다르게 동작한다.** 증상이 "이 지역엔 숙소가 없네요" 라서
 * 설정 문제로 안 보이고, 로컬에서 재현하려 해도 로컬이 또 다른 값이라 영영 안 잡힌다.
 *
 * ## 무엇을 재나
 *
 * 세 배포 서술(compose 인라인 기본값 · 로컬 k8s ConfigMap · EKS 차트)이 **같은 값**을 말하는지
 * 본다. 값 자체가 `db` 여야 한다고 못 박지는 않는다 — 바꾸려면 **세 곳을 함께** 바꾸라는 뜻이다.
 *
 * `application.yml` 의 기본값(`stub`)은 **일부러 제외한다.** 그건 배포 서술이 아니라
 * "아무 설정이 없을 때"의 안전값이고, 시드 없는 환경(테스트·최초 기동)에서 검색이 도는 근거다.
 * 그쪽까지 `db` 로 맞추면 CI 가 정본 테이블에 의존하게 된다.
 *
 * ## 유지 판정
 *
 * 12개월 관찰 — 이 테스트가 실제 드리프트를 잡은 건수가 0이고 파일 이동으로 인한 오탐이
 * 1건 이상이면 뗀다. (지금은 드리프트를 **실제로 잡아서** 만들어진 것이다.)
 */
class StayContentModeParityTest : StringSpec({

    fun repoFile(rel: String): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            val f = File(dir, rel)
            if (f.isFile) return f
            dir = dir.parentFile
        }
        error("파일을 찾지 못했습니다: $rel (user.dir=${System.getProperty("user.dir")})")
    }

    /** `${STAY_CONTENT_MODE:-db}` 의 인라인 기본값. */
    val compose = Regex("""STAY_CONTENT_MODE:-(\w+)}""")
        .find(repoFile("docker-compose.yml").readText())
        ?.groupValues?.get(1)

    /** ConfigMap 의 `STAY_CONTENT_MODE: "db"`. 없으면 null 이고, 그게 드리프트다. */
    val localK8s = Regex("""STAY_CONTENT_MODE:\s*"?(\w+)"?""")
        .find(repoFile("deploy/k8s/backend/configmap.yaml").readText())
        ?.groupValues?.get(1)

    /** Helm 템플릿의 `- name: STAY_CONTENT_MODE` 다음 줄 `value:`. */
    val eks = Regex("""name:\s*STAY_CONTENT_MODE\s*\n\s*value:\s*"?(\w+)"?""")
        .find(repoFile("deploy/eks/chart/templates/backend.yaml").readText())
        ?.groupValues?.get(1)

    "세 배포 서술이 같은 숙소 콘텐츠 경로를 말한다" {
        // null 이면 그 경로에 설정이 아예 없다는 뜻이다 — 기본 stub 으로 조용히 갈린다.
        listOf("compose" to compose, "local-k8s" to localK8s, "eks" to eks)
            .filter { it.second == null }
            .map { it.first } shouldBe emptyList()

        setOf(compose, localK8s, eks).size shouldBe 1
    }

    /**
     * 정본 테이블을 읽는 값이어야 **12,782곳**이 나간다. 이 줄이 없으면 위 스펙은 셋이 나란히
     * `stub` 이어도 통과한다 — 일치만 보고 무엇으로 일치하는지는 안 보게 된다.
     */
    "배포 경로는 정본 테이블을 읽는다 — 스텁 제주 5곳이 아니다" {
        compose shouldBe "db"
    }
})
