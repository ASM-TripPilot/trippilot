package com.trippilot.placedata.adapter.out.persistence

import com.trippilot.placedata.domain.Region
import com.trippilot.placedata.domain.RegionCatalogPort
import com.trippilot.placedata.domain.RegionLevel
import com.trippilot.placedata.domain.coverageOf
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.IdClass
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.stereotype.Component
import java.io.Serializable

/** region(V2.24) 매핑. 읽기 전용 — 채우는 것은 Flyway 시드(`R__seed_region_catalog.sql`)다. */
@Entity
@Table(name = "region")
class RegionEntity(
    @Id @Column(name = "region_code") var regionCode: String = "",
    @Column(name = "name") var name: String = "",
    @Column(name = "sido_code") var sidoCode: String = "",
    @Column(name = "sido_name") var sidoName: String = "",
    @Column(name = "level") var level: String = "",
    @Column(name = "selectable") var selectable: Boolean = false,
    /** 대표 좌표(V2.24 컬럼 · `R__update_region_center.sql` 이 채운다). 데이터 없는 지역은 null. */
    @Column(name = "lat") var lat: Double? = null,
    @Column(name = "lng") var lng: Double? = null,
)

/** 복합 PK 식별자. 엔티티와 달리 ID 클래스는 값이므로 `data class` 가 맞다. */
data class RegionAliasId(
    var alias: String = "",
    var regionCode: String = "",
) : Serializable

/** region_alias(V2.24) — 폐지된 옛 이름으로도 찾게 하는 검색 전용 테이블. */
@Entity
@Table(name = "region_alias")
@IdClass(RegionAliasId::class)
class RegionAliasEntity(
    @Id @Column(name = "alias") var alias: String = "",
    @Id @Column(name = "region_code") var regionCode: String = "",
)

interface RegionJpaRepository : JpaRepository<RegionEntity, String> {

    /**
     * 이름 또는 **별칭** 부분일치 + 층 필터.
     *
     * 별칭은 연관관계로 매핑하지 않고 `exists` 서브쿼리로 본다 — 조인하면 별칭이 여럿인 지역이
     * 결과에 중복으로 나오고, `distinct` 로 지우면 정렬이 다시 흔들린다.
     *
     * 정렬은 시도 → 층(시도 먼저) → 이름. 화면이 시도로 묶어 보여주므로 그 순서가 그대로 필요하다.
     * 층은 `level` 문자열이 아니라 **코드 길이**로 정렬한다 — 'SIDO' < 'SIGUNGU' 가 사전순으로도 맞지만
     * 그건 우연이고, 층 이름이 바뀌면 조용히 순서가 뒤집힌다.
     *
     * **[q] 의 LIKE 메타문자는 어댑터가 이스케이프해 넘긴다**([escapeLike]) — 그래서 `escape` 절이 붙는다.
     * 없으면 사용자가 친 `_` 가 "아무 글자 하나"로 해석돼 **빈 결과 대신 전체 목록**이 온다.
     *
     * **[q] 는 null 을 받지 않는다.** `:q is null or … concat('%', :q, '%')` 로 쓰면 검색어 없는 호출이
     * 500 으로 끝난다 — Hibernate 가 null 파라미터의 타입을 `concat` 안에서 추론하지 못해 bytea 로 보내고
     * `operator does not exist: character varying ~~ bytea` 가 난다(실측). 빈 문자열이면 `%%` 라
     * 전부 일치하므로 분기 자체가 필요 없다.
     */
    @Query(
        "select r from RegionEntity r where " +
            "(:level is null or r.level = :level) and " +
            "(r.name like concat('%', :q, '%') escape '\\' or exists (" +
            "  select 1 from RegionAliasEntity a where a.regionCode = r.regionCode " +
            "  and a.alias like concat('%', :q, '%') escape '\\'))" +
            " order by r.sidoCode, length(r.regionCode), r.name",
    )
    fun search(@Param("q") q: String, @Param("level") level: String?): List<RegionEntity>

    /** 이름 또는 별칭 정확 일치(TRIP-360 목적지 검증). 부분일치가 아니라 `=` 다. */
    @Query(
        "select r from RegionEntity r where r.name = :n or exists (" +
            "  select 1 from RegionAliasEntity a where a.regionCode = r.regionCode and a.alias = :n)" +
            " order by r.regionCode",
    )
    fun findExact(@Param("n") name: String): List<RegionEntity>
}

@Component
class RegionCatalogAdapter(
    private val jpa: RegionJpaRepository,
    private val pois: PoiJpaRepository,
) : RegionCatalogPort {

    /**
     * 커버리지는 **저장된 값이 아니라 지금 센 값**이다(TRIP-359) — 저장하면 POI 를 쓰는 경로를
     * 하나만 빠뜨려도 조용히 낡는다. 집계는 코드별로 한 번 모아 오고, 시도 롤업만 앱에서 접는다.
     */
    override fun findExact(name: String): List<Region> {
        val key = name.trim()
        if (key.isEmpty()) return emptyList()
        // 커버리지는 여기서 세지 않는다 — 검증만 하는 자리라 POI 집계는 낭비다.
        return jpa.findExact(key).map { it.toDomain(emptyMap()) }
    }

    override fun find(query: String?, level: RegionLevel?): List<Region> {
        val counts = pois.countActiveByRegionCode()
            .associate { (code, n) -> code as String to (n as Number).toInt() }
        return jpa.search(escapeLike(query?.trim().orEmpty()), level?.name).map { it.toDomain(counts) }
    }

    /**
     * LIKE 메타문자를 글자 그대로 만든다. 지역 이름에는 `%`·`_` 가 없으므로 결과는 "없음"이 맞고,
     * 이스케이프하지 않으면 `_` 한 글자가 **전체 목록**을 부른다. 역슬래시를 먼저 바꿔야 한다 —
     * 나중에 바꾸면 방금 넣은 이스케이프까지 다시 이스케이프된다.
     */
    private fun escapeLike(v: String): String =
        v.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    private fun RegionEntity.toDomain(counts: Map<String, Int>) = Region(
        regionCode = regionCode,
        name = name,
        sidoCode = sidoCode,
        sidoName = sidoName,
        level = RegionLevel.valueOf(level),
        selectable = selectable,
        poiCount = coverageOf(regionCode, counts),
        lat = lat,
        lng = lng,
    )
}
