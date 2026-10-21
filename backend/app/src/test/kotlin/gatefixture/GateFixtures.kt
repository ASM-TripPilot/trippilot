package gatefixture

import jakarta.validation.Valid
import jakarta.validation.constraints.Size
import org.hibernate.validator.constraints.CodePointLength
import org.springframework.stereotype.Controller
import org.springframework.web.bind.annotation.RequestBody

/**
 * `RequestStringBoundGateTest` 의 자기 검증용 표본. **`com.trippilot` 밖에 둔다** — 앱이 `com.trippilot` 을 컴포넌트 스캔하므로
 * 안에 두면 이 컨트롤러가 모든 통합 테스트 컨텍스트에 등록된다.
 */
class Bounded(@field:Size(max = 5) val a: String, @field:CodePointLength(max = 5) val b: String)

class MinOnly(@field:Size(min = 1) val a: String, @field:CodePointLength(min = 1) val b: String)

class ArrayField(val a: Array<String>)

open class Base(@field:Size(max = 5) val inherited: String = "", val bare: String = "")

class Child(@field:Size(max = 5) val own: String) : Base()

class Holder(val nested: Bounded)

class ListElement(@field:Size(max = 5) val a: String)

/** 같은 단순 이름을 가진 다른 클래스 — 면제 키가 단순 이름이면 서로를 덮는다. */
class Twin { class Item(val name: String = "") }

class Other { class Item(val name: String = "") }

/** `@RestController` 가 아니라 `@Controller` — 본문은 똑같이 들어온다. */
@Controller
class PlainController {
    fun bounded(@Valid @RequestBody body: Bounded) = Unit
    fun minOnly(@Valid @RequestBody body: MinOnly) = Unit
    fun array(@Valid @RequestBody body: ArrayField) = Unit
    fun child(@Valid @RequestBody body: Child) = Unit
    fun unvalidatedNested(@Valid @RequestBody body: Holder) = Unit
    fun list(@Valid @RequestBody body: List<ListElement>) = Unit
    fun unvalidatedList(@RequestBody body: List<ListElement>) = Unit
    fun twin(@Valid @RequestBody body: Twin.Item) = Unit
    fun other(@Valid @RequestBody body: Other.Item) = Unit
}
