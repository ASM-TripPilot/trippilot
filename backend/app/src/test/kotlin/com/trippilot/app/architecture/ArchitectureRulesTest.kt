package com.trippilot.app.architecture

import com.tngtech.archunit.base.DescribedPredicate.describe
import com.tngtech.archunit.core.domain.JavaClass.Predicates.resideInAPackage
import com.tngtech.archunit.core.domain.JavaClass.Predicates.resideInAnyPackage
import com.tngtech.archunit.core.domain.JavaMethodCall
import com.tngtech.archunit.core.importer.ClassFileImporter
import com.tngtech.archunit.core.importer.ImportOption
import com.tngtech.archunit.lang.conditions.ArchConditions.callMethodWhere
import com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes
import com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses
import com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices
import com.trippilot.changelog.api.ChangeLogFacade
import org.junit.jupiter.api.Test
import org.springframework.boot.autoconfigure.SpringBootApplication

/**
 * TRIP-150 — 모듈 경계 규칙 게이트(R1·R4·R5). CI(`./gradlew build`)에서 위반 시 빌드 실패.
 * 모듈이 아직 비어 있어 일부는 현재 통과(vacuous)하나, 코드가 늘면 자동 발동한다.
 * R2(domain 순수성)는 KonsistRulesTest, R3·R6(application 포트·컨트롤러 인증가드)는 해당 레이어·보안 도입 시 추가.
 */
class ArchitectureRulesTest {

    private val importedClasses = ClassFileImporter()
        .withImportOption(ImportOption.DoNotIncludeTests())
        .importPackages("com.trippilot")

    @Test
    fun `R5-1 common은 상위 계층(app·modules)에 의존하지 않는다`() {
        noClasses().that().resideInAnyPackage("com.trippilot.core..", "com.trippilot.security..")
            .should().dependOnClassesThat().resideInAnyPackage(
                "com.trippilot.app..",
                "com.trippilot.auth..", "com.trippilot.profile..", "com.trippilot.moderation..",
                "com.trippilot.accommodationsearch..",
                "com.trippilot.savedaccommodation..",
                "com.trippilot.trip..",
                "com.trippilot.placedata..",
                "com.trippilot.itinerarygeneration..",
                "com.trippilot.changelog..",
                "com.trippilot.archive..",
                "com.trippilot.reflection..",
            )
            .because("R5: 의존 방향 app→modules→common, 역방향 금지")
            .allowEmptyShould(true)
            .check(importedClasses)
    }

    @Test
    fun `R5-2 modules는 app에 의존하지 않는다`() {
        noClasses().that().resideInAnyPackage(
            "com.trippilot.auth..", "com.trippilot.profile..", "com.trippilot.moderation..",
            "com.trippilot.accommodationsearch..",
            "com.trippilot.savedaccommodation..",
            "com.trippilot.trip..",
            "com.trippilot.placedata..",
            "com.trippilot.itinerarygeneration..",
            "com.trippilot.changelog..",
            "com.trippilot.archive..",
        )
            .should().dependOnClassesThat().resideInAPackage("com.trippilot.app..")
            .because("R5: app 만 조립. 모듈은 app 을 모른다")
            .allowEmptyShould(true)
            .check(importedClasses)
    }

    @Test
    fun `R4 @SpringBootApplication은 app 에만 존재한다`() {
        classes().that().areAnnotatedWith(SpringBootApplication::class.java)
            .should().resideInAPackage("com.trippilot.app..")
            .because("R4: 조립·컴포넌트스캔은 app 소유")
            .allowEmptyShould(true)
            .check(importedClasses)
    }

    /**
     * BR-U5-29 — 기록·회고(U5)는 `change_log_entry` 를 **읽기만** 한다. 쓰기(append)는 변경을 만든 모듈
     * (편집 U3 · Plan-B U4)이 자기 트랜잭션 안에서 남기는 것이라, 아카이브가 사후에 덧쓰면
     * "무엇을 왜 바꿨는지"의 출처가 둘이 된다.
     *
     * U5 모듈은 아직 없어 지금은 vacuous 지만, 패키지가 생기는 순간 발동한다(이 파일의 기존 규칙과 같은 방식).
     * 어댑터·엔티티 직접 접근(SQL 로 쓰는 경로)은 R1 이 막는다 — 단 U5 모듈을 그 슬라이스 목록에 함께 등록해야 한다.
     */
    @Test
    fun `BR-U5-29 기록·회고(U5)는 변경 이력을 쓰지 않는다`() {
        noClasses().that().resideInAnyPackage("com.trippilot.archive..", "com.trippilot.reflection..")
            .should(
                callMethodWhere(
                    describe<JavaMethodCall>("ChangeLogFacade.append 를 호출") {
                        it.name == "append" && it.targetOwner.isAssignableTo(ChangeLogFacade::class.java)
                    },
                ),
            )
            .because("BR-U5-29: U5 는 change_log_entry 를 읽기만 한다 — 이력 생산은 변경을 만든 모듈 소유")
            .allowEmptyShould(true)
            .check(importedClasses)
    }

    @Test
    fun `R1 모듈 간 상호작용은 api 로만 (내부 직접참조 금지)`() {
        slices().matching("com.trippilot.(auth|profile|moderation|accommodationsearch|savedaccommodation|trip|placedata|itinerarygeneration|changelog|recalculation|planbdetection|weathercontext|archive|reflection)..")
            .should().notDependOnEachOther()
            // 다른 모듈의 api 퍼사드 의존은 허용(architecture.md). 내부(domain·application·adapter) 참조만 금지.
            .ignoreDependency(resideInAnyPackage("com.trippilot.."), resideInAPackage("..api.."))
            .because("R1: 모듈은 서로의 내부에 의존 금지 — api 퍼사드/이벤트로만")
            .allowEmptyShould(true)
            .check(importedClasses)
    }
}
