package com.trippilot.placedata.adapter.`in`.web

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import com.trippilot.placedata.FakeRegionCatalog
import com.trippilot.placedata.InMemoryPoiRepository
import com.trippilot.placedata.application.PoiProposalIngestService
import com.trippilot.placedata.domain.ImageLicense
import com.trippilot.placedata.domain.PoiSource
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/**
 * 수집본(`collected_pois.json`)의 `provenance.cpyrht_div_cd` 가 저장된 POI 의 사진 유형까지 가는가(#1716 → V2.88).
 * 키 이름이 한 글자만 틀려도 예외 없이 **전부 null** 이 되고 앱은 3유형 사진을 계속 자른다 — 문서 원문으로 태운다.
 */
class PoiProposalImageLicenseTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-11-02T03:00:00Z"), ZoneOffset.UTC)

    fun item(ref: String, provenanceExtra: String) = """
        {"poi": {"name": "경복궁", "category": "SIGHT", "coord": {"lat": 37.58, "lng": 126.97}},
         "region": "종로구",
         "provenance": {"content_id": "$ref", "image_url": "https://tong.visitkorea.or.kr/$ref.jpg"$provenanceExtra}}
    """

    fun ingest(vararg items: String, repo: InMemoryPoiRepository = InMemoryPoiRepository()): InMemoryPoiRepository {
        val doc = jacksonObjectMapper().readValue<PoiProposalDocument>(
            """{"schema_version": 1, "source": "TOURAPI", "proposals": [${items.joinToString(",")}]}""",
        )
        PoiProposalIngestService(repo, FakeRegionCatalog, clock).ingest(PoiSource.TOURAPI, doc.proposals.map { it.toCommand() })
        return repo
    }

    "원문 Type1·Type3 은 저장된 POI 의 유형이 되고, 키가 없거나 모르는 값이면 null 이다" {
        val repo = ingest(
            item("T1", """, "cpyrht_div_cd": "Type1""""),
            item("T3", """, "cpyrht_div_cd": "Type3""""),
            item("NONE", ""),
            item("ODD", """, "cpyrht_div_cd": "Type9""""),
        )

        repo.stored.associate { it.sourceRef to it.imageLicense } shouldBe mapOf(
            "T1" to ImageLicense.TYPE1, "T3" to ImageLicense.TYPE3, "NONE" to null, "ODD" to null,
        )
    }

    "유형 없이 적재된 행은 다음 적재가 같은 사진에 유형을 주면 채워진다 — 갱신 경로도 값을 나른다" {
        val repo = ingest(item("T3", ""))
        ingest(item("T3", """, "cpyrht_div_cd": "Type3""""), repo = repo)

        repo.stored.single().imageLicense shouldBe ImageLicense.TYPE3
    }
})
