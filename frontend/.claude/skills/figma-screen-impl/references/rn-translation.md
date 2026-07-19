# RN + NativeWind 번역 레퍼런스

Figma 생성 코드(웹 React + Tailwind)를 우리 스택(React Native + NativeWind)으로 옮길 때의 매핑·우회·함정. SKILL.md 4단계에서 참조한다.

## CSS/Figma → RN/NativeWind 매핑

| Figma / 웹 CSS | RN + NativeWind | 비고 |
|---|---|---|
| `flex flex-col/row items-* justify-*` | 동일 className | RN은 기본이 flex고 **기본 방향이 column** — `flex-row`를 명시해야 가로 |
| `gap-[Npx]` | `gap-<토큰>` 또는 `gap-[Npx]` | 토큰 있으면 토큰, 일회성이면 임의값 |
| `position:absolute; left/top` | `absolute` + 부모 `relative`, **또는 flex 재구성** | 좌표 복붙 금지(아래 "절대좌표" 절) |
| `bg-gradient-to-b from-x to-y` | `<LinearGradient colors={[x,y]}>` (expo-linear-gradient) | RN엔 CSS 그라디언트 없음 |
| `shadow-[0px_2px_6px_rgba(..)]` | `shadow-*`(NativeWind) 또는 style `shadowColor/Offset/Opacity/Radius`(iOS) + `elevation`(Android) | 플랫폼별 그림자 모델 상이 |
| `border-[1.5px] border-[#ddd]` | `border-[1.5px] border-hairline-strong` | 색은 토큰으로 |
| `rounded-[12px]` | `rounded-button`(role) 또는 `rounded-[12px]` | 동률 토큰은 role로 |
| `font-['Noto_Sans_KR:Bold']` | `font-noto-bold` + **expo-font 번들** | 폰트 파일 없으면 시스템 폰트로 렌더(정합 깨짐) |
| `<img src={svgUrl}/>` | `react-native-svg`의 `<Svg>` / 변환 컴포넌트 | 아이콘·로고=SVG |
| `<img src={pngUrl}/>` | `<Image source={require('...')}/>` | 래스터 |
| `text-[22px]` | `text-hero`(토큰) | fontSize 토큰 매핑 |
| `whitespace-nowrap overflow-clip [word-break]` | 대개 제거 | 웹 전용, RN 무의미 |
| `size-full w-full` | `flex-1` / `w-full` | |

## RN이 지원 안 하는 것 → 우회

- CSS 그라디언트 → **expo-linear-gradient**
- 다중 box-shadow → 단일 shadow(iOS) + elevation(Android)
- `letter-spacing` 단위 문자열 → `letterSpacing` 숫자
- `z-index` → 렌더 순서 / elevation
- `grid` → flex
- 가상요소 `::before/::after` → 실제 `<View>`

## expo-linear-gradient (그라디언트 배경)

```tsx
import { LinearGradient } from 'expo-linear-gradient';
// bg-gradient-to-b from-[#ffffff] via-[#fff3f6] to-[#ffe1e7]
<LinearGradient colors={['#ffffff', '#fff3f6', '#ffe1e7']} locations={[0, 0.55, 1]} className="flex-1">
  {children}
</LinearGradient>
```

## react-native-svg (아이콘/로고)

- SVG 파일을 `src/assets/<feature>/`에 두고 `react-native-svg`(+ `react-native-svg-transformer` metro 설정)로 컴포넌트 import, 또는 `<SvgXml>`로 인라인.
- 브랜드 아이콘은 SVG 안에 브랜드색이 있으므로 색 토큰 불필요.

## 폰트 번들 (expo-font)

디자인 폰트를 `assets/fonts/`에 넣고 로드:
```tsx
import { useFonts } from 'expo-font';
const [loaded] = useFonts({ 'Inter-Bold': require('...'), 'NotoSansKR-Bold': require('...'), 'NotoSansKR-Regular': require('...') });
```
`tailwind.config` `theme.extend.fontFamily`에 매핑해 `font-inter-bold`·`font-noto-regular` 유틸로 쓴다.

## testID 보존이 왜 중요한가

화면은 **프레젠테이션(그림)만 바꾸고 동작 계약은 불변**이어야 한다. 기존 컴포넌트의 testID(`auth-login-google`·`shell-splash-root` 등)를 그대로 유지하면 dev-cycle의 행위 테스트(게이트① 동결 해시)가 **수정 없이 green**으로 남는다 → 비주얼 리팩토링이 회귀 0. testID를 바꾸면 승인된 테스트 계약을 깨는 것이라 게이트 재제시 사유가 된다. **먼저 기존 컴포넌트의 testID 목록을 확인**하고 재작성 시 1:1로 보존하라.

## 절대좌표 → flex 재구성

Figma가 `left/top`으로 흩뿌린 좌표를 그대로 옮기면 화면 크기가 바뀔 때 깨진다. 화면을 **의미 존**으로 읽어라:

- 예(스플래시): 상단 일러스트 존 / 중앙 브랜드(아이콘+텍스트) 존 / 하단 인디케이터 → `SafeAreaView` + `flex-col` + `spacer(flex-1)`로 세로 3분할. 배경 위를 떠다니는 장식 요소(핀 등)만 `absolute` 오버레이로.
- 예(로그인): 세로 스택(`flex-col gap-*`) — 브랜드 블록 / 소셜버튼 리스트 / (구분선) / 푸터. 각 소셜버튼은 `flex-row items-center justify-center gap-*`.

목표는 픽셀 복제가 아니라 **동일하게 보이는 반응형 구조**다.
