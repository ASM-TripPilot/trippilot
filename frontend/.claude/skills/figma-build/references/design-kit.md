# TripPilot 디자인 킷 (Figma 정본)

> 화면을 **일관되게** 그리고 고치기 위한 Figma 쪽 정본. **값(색·반경·간격·폰트)의 정본은 코드 `frontend/tailwind.config.js`**(`src/__tests__/design-tokens.test.ts`가 심판)이고, 이 킷은 그 값의 Figma 변수명·헬퍼·레시피·이 파일 고유 함정이다. 값을 즉석에서 바꾸지 않는다.
>
> **유래:** VoltAgent/awesome-design-md `airbnb/DESIGN.md`(웹 1440·Cereal)를 2026-07에 모바일 390 + Noto/Inter + TripPilot 컴포넌트로 각색. 무드(코랄 1색 볼티지·photo-first·soft shape·그림자 1단)만 가져왔고 값은 코드 토큰이 정본이다. **원본은 참조하지 않는다** — 킷에 없는 값은 만들지 말고 질문으로 돌린다.

## 목차
1. 무드 & 5원칙
2. 색 토큰 (Figma Variables)
3. 반경·간격·그림자
4. 타이포 & 폰트 매핑
5. 재사용 use_figma 헬퍼
6. 아이콘 SVG 셋
7. 부산 사진 imageHash
8. 컴포넌트 레시피
9. 운영 함정

---

## 0. 파운데이션 node id (2026-07-12 승인분, 라이브에서 못 찾으면 이 줄을 고친다)
Variables `1229:1045`(Light `1229:0`) · 컴포넌트 Button `1232:1052`·Chip `1232:1058`·Badge `1233:1051`·Banner `1233:1069`·SearchBar `1234:1045`·Card `1234:1059`·AppBar `1235:1045`·BottomTab `1236:1177` · Icon 세트 `1237:1159` · 카탈로그 섹션 `1230:1045` · 앱 아이콘 `1243:1046`/워드마크 `1243:1051`/반전 `1243:1060`.

## 1. 무드 & 5원칙
**Trust & Warmth** — 따뜻·친근·사진이 주인공. 화려함이 아니라 절제된 craft.
1. **코랄 1색 볼티지만** — `#FF385C`는 CTA·♥·핀·활성탭·배지·강조에만. 장식색 금지. 화면 90%는 흰/잉크.
2. **깊이는 얇게** — 흰 카드 + 헤어라인 + 아주 옅은 그림자 하나. 두꺼운 그림자·다단계 elevation 금지.
3. **형태는 부드럽게** — 카드·버튼·칩 반경은 §3 값. 하드코너 없음.
4. **사진 우선** — 히어로·카드·타일은 실사진(부산 7종) 컬러. 회색 플레이스홀더 박스 금지.
5. **상태는 전부 그린다** — default/empty/loading/error 빈 화면 없음. 대괄호 플레이스홀더(`[아이콘]`) 금지 → 실제 벡터/사진.

---

## 2. 색 토큰 (Figma Variables — 컬렉션 `AirbnbHiFi`, `VariableCollectionId:1229:1045`, 모드 Light `1229:0`)
정본 = `tailwind.config.js` `colors` 25종. 아래 표는 그 미러 + 용도. **코드에 없는 hex는 쓰지 않는다**(`token-snapper` MISS).
바인딩 대상 스코프: 배경/면=FRAME_FILL·SHAPE_FILL, 텍스트=TEXT_FILL, 반경=CORNER_RADIUS.

| 토큰 | hex | 용도 |
|---|---|---|
| `color/primary` | `#FF385C` | 주요 CTA·♥·활성·강조 (Rausch) |
| `color/primary-active` | `#E00B41` | 눌림 |
| `color/primary-pale` | `#FFE4E9` | 코랄 연한 배경(칩·아바타틴트) |
| `color/primary-text` | `#C13515` | 코랄 위/연배경 위 진한 텍스트 |
| `color/canvas` | `#FFFFFF` | 기본 배경 |
| `color/canvas-alt` | `#FAFAFA` | 지도/타임라인 화면 배경 |
| `color/surface-soft` | `#F7F7F7` | 카드 뜨는 배경 |
| `color/surface-strong` | `#F2F2F2` | 아이콘버튼·썸네일 자리 |
| `color/hairline` | `#EDEDED` | 카드 1px 경계 |
| `color/hairline-strong` | `#DDDDDD` | 입력·아웃라인 버튼 경계 |
| `color/ink` | `#222222` | 제목·본문 (순검정 아님) |
| `color/body` | `#3F3F3F` | 보조 본문 |
| `color/muted` | `#6A6A6A` | 캡션·비활성 라벨·더보기 |
| `color/muted-soft` | `#9AA1AB` | 플레이스홀더·비활성 아이콘 |
| `color/link` | `#1659C9` | 해시태그·링크 |
| `color/info` | `#0B6E63` | 정보/컨텍스트칩(청록 보조) |
| `color/info-bg` · `color/info-border` | `#F0FCFA` · `#A1E8DD` | 정보칩 배경·경계 |
| `color/on-primary` | `#FFFFFF` | 코랄 위 글자 |
| `color/success` · `color/success-bg` | `#0E9384` · `#E4F5F1` | 완료·확정 상태, 틸 아바타 틴트 |
| `color/presence-blue` · `color/presence-blue-bg` | `#1B6EF3` · `#E7F0FB` | 협업 프레즌스(동행자) — **이 용도 외 blue 금지** |
| `color/presence-teal` | `#14B8A6` | 협업 프레즌스 |
| `color/scrim` | `#000000` @40% | 시트·모달 딤 |

다크모드 미정(라이트 전용). 협업 프레즌스 = primary / presence-blue / presence-teal(민·준·서).

---

## 3. 반경·간격·그림자
- 반경(Variables `radius/*` = 코드 `borderRadius`): card 16 · sheet-top 24 · button 12 · input 12 · thumb 12 · pill/chip 999.
- 간격: 코드 spacing 램프 **4/8/12/16/20/24/32**만. 화면 좌우 16, 섹션 gap 20~24, 카드 내부 16(콤팩트 12), 칩 padding 12×8, 칩 gap 8. (2026-07 화면 일부는 14로 그려졌다 — 신규·수정은 램프 값.)
- 그림자(카드·pill·시트 딱 하나): `DROP_SHADOW rgba(0,0,0,0.08) offset(0,4) blur16` (작은건 0.06/2/10). 그 외 flat.

### 3.1 배치 원리 (값이 아니라 결정)
- 간격은 4의 배수만. 좌우 여백 16 고정. 중요한 것은 위·왼쪽, 텍스트는 왼쪽 정렬(가운데는 empty·온보딩 같은 짧은 독립 콘텐츠만).
- 묶일 것은 8~12로 붙이고 다른 섹션은 24~32로 띄운다 — 선·박스보다 **여백**으로 나눈다.
- 터치 타깃 ≥44(QA F). 주요 액션·탭바·FAB는 하단(엄지 존), 파괴적 액션은 닿기 어려운 곳 + 확인.
- 이미지 비율: 1:1 아바타·정사각 썸네일 / 4:3 숙소·장소 카드 / 16:9 히어로·지도 프리뷰 / 3:4 세로 포토카드. **같은 리스트 안에서는 한 비율.**
- 여백은 도구다 — 화면을 채우려 하지 마라.

---

## 4. 타이포 & 폰트 매핑
Airbnb Cereal·Pretendard·**Noto Sans KR Medium**은 use_figma에서 **로드 실패**. 로드 가능: **Noto Sans KR (Regular·Bold)**, **Inter (Regular·Semi Bold·Bold)**. (코드 `noto-medium`은 있으나 Figma에서 못 그리므로 디자인은 Medium을 쓰지 않는다.)
- 한글 = Noto Sans KR. 라틴/숫자/워드마크 = Inter.
- 중간 굵기(Medium/SemiBold)는 없음 → 제목·강조=Bold, 본문·캡션=Regular.

| 역할(코드 `fontSize` 키) | 폰트/굵기 | px / lineHeight |
|---|---|---|
| display (온보딩·폼 대제목) | Noto Bold | 26 / 34 |
| hero (히어로 제목) | Noto Bold | 22 / 29 |
| section (섹션 제목) | Noto Bold | 17 / 23 |
| card-title | Noto Bold | 15 / 20 |
| body | Noto Regular | 14 / 20 |
| label (칩·버튼 소형·강조 캡션) | Noto Regular/Bold | 13 / 18 |
| caption·메타 | Noto Regular | 12 / 16 |
| micro (출처·배지 숫자) | Noto Regular | 11 / 14 |
| 워드마크 | Inter Bold 22, letterSpacing -2% |
| 숫자(가격·별점·통계) | Inter Bold | 램프 값 중 택 |
램프 밖 크기(12.5·14.5·20·24)는 쓰지 않는다 — 코드에 없다.

---

## 5. 재사용 use_figma 헬퍼 (매 스크립트 상단에 붙여넣기)
```js
const hex=(h)=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const solid=(h)=>({type:'SOLID',color:hex(h)});
const IMG=(hash)=>({type:'IMAGE',scaleMode:'FILL',imageHash:hash});
const SHADOW=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.08},offset:{x:0,y:4},radius:16,spread:0,visible:true,blendMode:'NORMAL'}];
const SHADOW_SM=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.06},offset:{x:0,y:2},radius:10,spread:0,visible:true,blendMode:'NORMAL'}];
// 폰트 로드(스크립트마다 1회): 
// await figma.loadFontAsync({family:'Noto Sans KR',style:'Regular'}); ...Bold; Inter Regular/Bold/'Semi Bold'
const K=(c,st,s,h)=>{const t=figma.createText();t.fontName={family:'Noto Sans KR',style:st};t.characters=c;t.fontSize=s;t.fills=[solid(h)];return t;}; // 한글
const I=(c,st,s,h)=>{const t=figma.createText();t.fontName={family:'Inter',style:st};t.characters=c;t.fontSize=s;t.fills=[solid(h)];return t;}; // 라틴/숫자
const svg=(s)=>figma.createNodeFromSvg(s);
// 세로 그라디언트(사진 위 텍스트용): fills=[{type:'GRADIENT_LINEAR',gradientTransform:[[0,1,0],[-1,0,1]],gradientStops:[{position:0.35,color:{r:0,g:0,b:0,a:0}},{position:1,color:{r:0,g:0,b:0,a:0.72}}]}]
// 가로 그라디언트(좌→우 어두움): gradientTransform:[[1,0,0],[0,1,0]], stops 0=0.7 / 0.85=0
```
루트 프레임 표준: `resize(390,H); layoutMode='VERTICAL'; primaryAxisSizingMode='AUTO'; counterAxisSizingMode='FIXED'; itemSpacing=0; fills=[solid('#FFFFFF')]` 그리고 정본 페이지 `1228:1045`에 appendChild 후 x/y 배치(밴드 x 간격 450).

---

## 6. 아이콘 SVG 셋 (createNodeFromSvg, Feather/Lucide 스타일 24×24, stroke 1.9~2.2 round)
스트로크 색은 `stroke="{색}"`으로 주입. 활성탭은 채움(fill) 버전.
```
back:    <svg .. fill="none" stroke="{c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
chevronR:<svg ..><polyline points="9 6 15 12 9 18"/></svg>
chevronD:<svg ..><polyline points="6 9 12 15 18 9"/></svg>
plus:    <svg .. stroke-width="2.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
close:   <svg ..><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
search:  <svg ..><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
filter:  <svg ..><line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="10" cy="8" r="2.6"/><circle cx="15" cy="16" r="2.6"/></svg>
bell:    <svg ..><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
share:   <svg ..><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.7" x2="15.4" y2="6.3"/><line x1="8.6" y1="13.3" x2="15.4" y2="17.7"/></svg>
send:    <svg ..><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
arrowUp: <svg .. stroke-width="2.4"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>
download:<svg ..><path d="M12 3v12"/><polyline points="8 11 12 15 16 11"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
comment: <svg ..><path d="M21 11.5a8.5 8.5 0 0 1-12.5 7.5L3 21l1.5-5.5A8.5 8.5 0 1 1 21 11.5z"/></svg>
star(fill):  <svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 18.6 6.1 20.8l1.2-6.6L2.5 9l6.6-.9z" fill="{c}"/></svg>
heart(fill): <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="{c}"/></svg>
heart(out on photo): 같은 path, fill="#000000" fill-opacity="0.22" stroke="#FFFFFF" stroke-width="1.8"
flame:   <svg viewBox="0 0 24 24"><path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 1.5.8 2.5 1.8 2.5 1 0 1.7-1 1.2-2.6C11.4 5 12 3.4 12 2z" fill="#FF385C"/></svg>
pin:     <svg ..><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>
grip:    <svg viewBox="0 0 24 24" fill="#DDDDDD"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
gear:    <svg ..><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
check:   <svg .. stroke="{c}" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
```
하단탭 채움 아이콘(활성): home/compass/calendar/bookmark/user를 `fill="#FF385C"` polygon/path로. 예 home-fill:`<svg viewBox="0 0 24 24"><path d="M3 10.6L12 3.2l9 7.4V20a1 1 0 0 1-1 1h-4.5v-6.2h-3v6.2H4a1 1 0 0 1-1-1z" fill="#FF385C"/></svg>`. compass-fill:`<circle r="9.2" fill="#FF385C"/>` + 흰 polygon. calendar/bookmark/user도 동일 원리.

### 자주 필요한 추가 아이콘 (stroke="{c}" 1.9~2.2, fill=none, round)
```
edit:      <svg ..><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
trash:     <svg ..><polyline points="3 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
clock:     <svg ..><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
info:      <svg ..><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
alert:     <svg ..><path d="M12 3l10 17H2z"/><line x1="12" y1="9" x2="12" y2="14"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
moreH:     <svg .. fill="{c}" stroke="none"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
extLink:   <svg ..><path d="M14 4h6v6"/><line x1="20" y1="4" x2="10" y2="14"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></svg>
image:     <svg ..><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><path d="M21 16l-5-5L5 21"/></svg>
lock:      <svg ..><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
checkCircle:<svg ..><circle cx="12" cy="12" r="9"/><polyline points="8.5 12.5 11 15 16 9.5"/></svg>
refresh:   <svg ..><path d="M20 11a8 8 0 1 0-1.5 5"/><polyline points="20 4 20 11 13 11"/></svg>
coffee:    <svg ..><path d="M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M16 9h2.5a2.5 2.5 0 0 1 0 5H16"/><line x1="7" y1="3" x2="7" y2="5"/><line x1="11" y1="3" x2="11" y2="5"/></svg>
envelope:  <svg ..><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
pin-off:   <svg ..><path d="M5.4 5.4A8 8 0 0 0 4 10c0 6 8 12 8 12a30 30 0 0 0 3.6-3.5"/><path d="M19.2 13.5A8 8 0 0 0 20 10 8 8 0 0 0 6.6 4.1"/><path d="M9.1 9.1A3 3 0 0 0 12 13a3 3 0 0 0 2.9-2.1"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
bed:       <svg ..><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>
users:     <svg ..><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
sparkle(fill): <svg viewBox="0 0 24 24"><path d="M12 2 L13.8 10.2 L22 12 L13.8 13.8 L12 22 L10.2 13.8 L2 12 L10.2 10.2 Z" fill="{c}"/></svg>
minus:     <svg .. stroke-width="2.4"><line x1="5" y1="12" x2="19" y2="12"/></svg>
helpCircle:<svg ..><circle cx="12" cy="12" r="9"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
sun:       <svg ..><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4.5"/><line x1="12" y1="19.5" x2="12" y2="22"/><line x1="4.2" y1="4.2" x2="6" y2="6"/><line x1="18" y1="18" x2="19.8" y2="19.8"/><line x1="2" y1="12" x2="4.5" y2="12"/><line x1="19.5" y1="12" x2="22" y2="12"/><line x1="4.2" y1="19.8" x2="6" y2="18"/><line x1="18" y1="6" x2="19.8" y2="4.2"/></svg>
utensils:  <svg ..><path d="M7 2v9"/><path d="M4 2v4a3 3 0 0 0 6 0V2"/><path d="M7 11v11"/><path d="M17 2c-1.8 1.2-2.5 3.5-2.5 6 0 2 1 3.5 2.5 3.5V22"/></svg>
mountain:  <svg ..><path d="M3 20l6-11 4 6 2.5-4L21 20z"/></svg>
bag:       <svg ..><path d="M6 2 3.5 6.5V20a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V6.5L18 2z"/><line x1="3.5" y1="7" x2="20.5" y2="7"/><path d="M16 11a4 4 0 0 1-8 0"/></svg>
moon:      <svg ..><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
half-circle:<svg ..><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="{c}" stroke="none"/></svg>
menu:      <svg ..><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
link:      <svg ..><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
globe:     <svg ..><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>
anchor:    <svg ..><path d="M12 22V8"/><circle cx="12" cy="5" r="3"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/></svg>
compass:   <svg ..><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
```
> (2026-07-12 그룹 c에서 등록: envelope=이메일 인증, pin-off=위치권한 OFF)
> (2026-07-12 그룹 d에서 등록: bed=숙소 진입, users=여행자 일정 진입 — d01 탐색 랜딩 코랄 아이콘 타일)
> (2026-07-12 그룹 e에서 등록: sparkle=AI 어시스턴트 FAB ✦ — 코랄 56원 위 흰색 4각 스파클 fill, 사진/카드 목록 위에 뜨는 도우미 버튼)
> (2026-07-12 그룹 g에서 등록: minus=stepper 감소(plus의 가로선만), helpCircle=`[?]` 해결 프롬프트(거점 gap 등 "어느 것으로?" 질문 배너 아이콘, 중립 ink))
> (2026-07-12 그룹 h에서 등록: sun=휴양·힐링, utensils=맛집 투어, mountain=액티비티, bag=쇼핑, moon=야경·산책 — h02 목적 아이콘 원배지(44 코랄/뉴트럴) / half-circle=AI와 같이 짜기(원 stroke + 좌반원 fill=균형), menu=직접 짜기(가로 3선) — h04 시작 방법 옵션 카드. stroke 2·24 viewBox·round. 배치 2 [같이] 카테고리(식사/카페/전시/야외/쇼핑)는 utensils(식사)·coffee(카페·기존킷)·image(전시)·mountain 또는 sun(야외)·bag(쇼핑) 재사용)
> (2026-07-12 그룹 h Batch 2a[h09–h12]에서 등록: **번호 티어드롭 맵 핀** — 실제 지도(§8) 위 스톱 마커. solid=코랄 fill+흰 stroke2+흰 숫자(Inter Bold13)+옅은 그림자 / ghost(미배치)=흰 fill+`#9AA1AB` dashed stroke+muted 숫자. `<svg width="28" height="36" viewBox="0 0 28 36"><path d="M14 1 C6.8 1 1 6.5 1 13.5 C1 22 14 35 14 35 C14 35 27 22 27 13.5 C27 6.5 21.2 1 14 1 Z" fill="{c}" stroke="{s}" stroke-width="2"/></svg>` — 팁(14,35)이 좌표를 가리키게 node.x=cx−14·y=cy−35, 숫자는 원 중심 위 별도 Inter Bold 텍스트(center 정렬). 번호는 **화면별 카드 순서**(같은 위치·다른 번호). h/i 동선 지도 공용 재사용.)
> (2026-07-12 그룹 h Batch 2b[h13–h18]에서 등록: **① 글자 티어드롭 맵 핀**(반경 후보 지도 h14/h15) — 번호 티어드롭 SVG 그대로, 숫자 대신 글자 A/B/C/D(Inter Bold13). coral=반경 안 후보 / muted grey(`#9AA1AB` fill+흰 stroke, 그림자X)=반경 밖 후보. 카드 글자 배지(26 rounded-8)와 색 매칭. 반경 원=ellipse no-fill `#9AA1AB` dashed[5,4] r=norm중심, 현재위치=코랄 dot11+흰 stroke2+"현재 위치" 흰 pill. **② 글자 미니-원 마커**(옵션 교체 지도 h18) — 24 circle+글자(Inter Bold12), coral=현재/흰+`#9AA1AB` stroke=대안. 번호 티어드롭(일정 스톱)과 **의도적 구분**: "이 슬롯의 교체 후보 A/B/C" vs "동선 스톱 ①②…". 동선은 여전히 직선(§8), route는 현재(A)를 통과. i 그룹 반경/교체 지도 재사용 대비.)
> (2026-07-13 그룹 i Batch 2[i07–i11]에서 등록: **cloud-rain**(날씨 트리거 i08 칩·i09 감시항목) `<path d="M7 15.5a4.5 4.5 0 0 1-.5-8.98A6 6 0 0 1 18 7.5a4 4 0 0 1 .5 8"/>` + 빗줄 3선(x 8/12/16, y 18~21.5) · **store**(영업·휴무 i09) `<path d="M3 9.5 4.5 4h15L21 9.5"/><path d="M4.5 9.5V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V9.5"/><path d="M3 9.5h18"/><path d="M9.5 20v-5h5v5"/>`(어닝+몸통+문) · **transit**(교통 i09, ⇄ 이중 화살표) `<path d="M7 4 3 8l4 4"/><line x1="3" y1="8" x2="21" y2="8"/><path d="M17 20l4-4-4-4"/><line x1="21" y1="16" x2="3" y2="16"/>`. stroke 2·24 viewBox·round. i09 감시항목 배지=활성(날씨) coral-pale+coral / 정상 surface-strong+muted. **앱 아이콘(종이비행기)=코랄 rounded-6 사각 + 흰 paper-plane fill + `#FFCCD5` 접힘**(i07 푸시 알림 카드 28px, 파운데이션 `1243:1046` 재현). 라디오 원(i10 사유): empty=`#9AA1AB` stroke2 원 / selected=coral stroke2 원+r5 coral 중앙점. **◉ 현재위치 마커**(i10 지도 소형): coral ring(ellipse32 no-fill coral2.5)+coral dot14(흰 stroke)+"현재 위치" 흰 pill — 소형 strip이라 dot(teardrop 금지, build-i i05 정합).)
> (2026-07-13 그룹 k Batch 1[k01·k02]에서 등록: **bookmark**(outline, 인스타 피드 저장 아이콘 — BottomTab bookmark-fill과 별개 stroke 버전) `<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>` · **flag**(신고 🚩 대체, k02 신고 버튼) `<path d="M4 21V4"/><path d="M4 4h13l-2.5 4L17 12H4z"/>`. stroke 2·24 viewBox·round. **이니셜 원 아바타**(§7 아바타 사진 없음): 코랄 bg`#FFE4E9`/tx`#C13515` · 블루 bg`#E7F0FB`/tx`#1B6EF3` · 틸 bg`#E4F5F1`/tx`#0E9384`(닉네임 첫 글자, 다중 사용자 구분 — task 허용, "teal 0"은 [i]/[!] 청록 info 색 규칙이며 아바타 틴트는 별개). **carousel dots**(사진 위 절대배치 흰 ellipse6, 활성 opacity1·비활성 0.5). k02 지도=h_itin `312433b0…` 재사용, 5 코랄 번호핀+직선 route+bed(§8, 거점 무연결·무번호), 스케일 "1 km".)
> (2026-07-13 그룹 k Batch 3[k06·k07·k08]에서 등록: **diamond**(빈 상태 글리프, k06 empty '공개한 일정 없음' 히어로) `<path d="M12 3 L21 12 L12 21 L3 12 Z"/>` stroke 1.8·round·muted-soft(#9AA1AB), dashed rounded-24 박스 안 중앙 배치(다른 그룹 empty 히어로 재사용 가능). **진짜 디밍 바텀시트 패턴**(k08 신고 시트 = k03 중앙 모달의 하단정렬 변형): root 390×844 NONE → [배경 실게시물 hint(AppBar+§7 컬러 사진)] → [scrim rect 검정 opacity 0.58 전면] → [시트 vbox hug, **top-only radius**(topLeftRadius=topRightRadius=24·bottomLeft/Right=0), append 후 height 읽어 **y=844−height**(하단정렬)·x=0·상단 그림자 offset y−3 opacity0.14]. **grabber**=40×4 r2 #DDDDDD 중앙 hbox(시트 최상단). **라디오 원**(i10 계승): empty=frame24 r12 no-fill + #9AA1AB stroke2 / selected=coral stroke2 + 중앙 ellipse10 coral fill(x7 y7 절대, frame layoutMode NONE), selected 라벨 Bold ink·empty Regular body. **코랄 '공개 중' 상태 pill**(k06): coral-pale bg#FFE4E9 + tx#C13515 Bold11 r999(published 상태 표면 — 상태 pill만 코랄, 마스킹 칩은 뉴트럴 유지). **하단탭은 화면 소속 탭 원본 재확인**: 커뮤니티 '내' 관리 화면(내 공유목록 k06·숨김목록 k07)=**마이 active `1236:1150`**(피드 k01·k02는 탐색 `1236:1071`), 저장→기록 override 공통. BottomTab set `1236:1177` 변형: 홈`1236:1045`·탐색`1236:1071`·일정`1236:1098`·기록`1236:1123`·마이`1236:1150`.)
> (2026-07-13 그룹 k Batch 2[k03·k04·k05]에서 등록: **eye-off**(k04 프로필 '숨기기' 액션, 원본 ◎ 글리프→eye-off 시맨틱 '피드에서 숨기기') `<path d="M9.9 4.24A9 9 0 0 1 12 4c7 0 10 8 10 8a17 17 0 0 1-2.16 3.19"/><path d="M6.6 6.6A16 16 0 0 0 2 12s3 8 10 8a9 9 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><line x1="2" y1="2" x2="22" y2="22"/>`. stroke 2·24 viewBox·round. **진짜 디밍 모달 패턴**(k03 가져오기): root 390×844 NONE → [배경 실피드 hint(아바타 ellipse+텍스트바+§7 컬러 사진)] → [scrim rect 검정 opacity 0.55 전면] → [중앙 카드 vbox hug r20 SHADOW, x30·y=(844−card.height)/2 절대배치, append 후 height 읽어 center]. **토글 스위치**(k05: 46×27 r14, ON=coral fill+흰 knob21 우측 x22 / OFF=hairline-strong+knob 좌측 x3, knob=NONE 프레임 자식 절대). **코랄 체크박스**(k05 pub: 24 r7 coral fill+흰 check16, 확인된 상태). **trait dot 게이지**(k04: 5 dot10, 채움=뉴트럴 #3F3F3F·빈 #E4E4E4 — 원본 all-black 계승, 코랄 아님). **[확정] dark pill**(#222 bg+흰 12 Bold, 상태배지 뉴트럴-강). k04 프로필 썸네일=원본 미니맵→§7 컬러 포토 승격(회색박스 금지). kB2 지도 0.)

> (2026-07-13 그룹 l Batch 2[l04·l05]에서 등록: **user**(outline, 단일 사람 — l05 설정 '닉네임·이메일' 행. §6 하단탭 user-fill·k `users`[복수]와 별개 단일 stroke) `<circle cx="12" cy="8" r="4"/><path d="M5 20a7 7 0 0 1 14 0"/>` · **star**(outline, l05 '선호 활동' — §6 `star(fill)`은 별점용 fill이라 설정 아이콘용 stroke 버전 별도) `<path d="M12 2.6l2.7 5.6 6.2.9-4.5 4.3 1.1 6.1L12 17.7 6.4 20.4l1.1-6.1L3 9.1l6.2-.9z"/>` · **gauge**(l05 '일정 밀도·이동 선호' — 속도계, pace/density) `<path d="M3.5 15.5a9 9 0 1 1 17 0"/><path d="M12 15l4-4"/>`. stroke 2·24 viewBox·round. **예산 ₩ = text glyph**(아이콘 아님 — Inter Bold18, slot24 HF center 중앙 배치. 통화 기호는 vector 대신 텍스트 글리프 허용). **설정 그룹 행**=slot24(HF center·아이콘22 body stroke or ₩ text) + 라벨 Bold14.5(left group layoutGrow=1·label FILL·textAutoResize HEIGHT 긴 라벨 wrap 가드) + 우측 value muted14 / [상태 pill] / 토글 / chevronR20(mutedS). 카드=흰 r16 hairline SHS clipsContent + 행 사이 hr(h1 FILL). **거점 배지 pill**: active 거점=coral solid(#FF385C+흰 Bold12) / 미지정=dashed outline(muted-soft dash[4,3]·muted). **상태칩 [동의]**=coral-pale(bg#FFE4E9/tx#C13515) / [미설정]=뉴트럴 surface-strong. **위험 영역 [위험]·삭제 확인 버튼**=dark #222(뉴트럴-강, **코랄/빨강 금지** — 파괴적 액션은 비코랄). **dialog 확인 버튼 색 = 액션 성격**: 긍정/forward(일정 다시 생성)=코랄 / 파괴적(계정 삭제)=dark 뉴트럴. l04·l05 지도/사진 0.)
> (2026-07-13 그룹 l Batch 1[l01·l02·l03]에서 등록: **home**(outline, l01 알림 '숙소' 타입칩·l03 참고) `<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.8"/><path d="M9.5 21v-6.5h5V21"/>` · **list**(l01 '일정' 타입칩·l03 '내가 공유한 일정' 메뉴) `<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><line x1="4" y1="6" x2="4.4" y2="6"/><line x1="4" y1="12" x2="4.4" y2="12"/><line x1="4" y1="18" x2="4.4" y2="18"/>`(짧은 3선=round cap 불릿점) · **note/fileText**(l01 '회고' 타입칩) `<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>` · **barChart**(l03 '여행 스타일 분석' 메뉴) `<line x1="6" y1="20" x2="6" y2="13"/><line x1="12" y1="20" x2="12" y2="5"/><line x1="18" y1="20" x2="18" y2="9"/><line x1="3" y1="20" x2="21" y2="20"/>`. stroke 2·24 viewBox·round. 재사용: transit(⇄, i)·gear·bell(§6)·share·eye-off(k)·bed·plus·chevronR·back·info·alert. **알림 타입 아이콘칩**=40 rounded-10 surface-strong(#F2F2F2) + 아이콘22 stroke body(#3F3F3F, 뉴트럴 소프트). **코랄 안읽음 dot**=ellipse8 coral(읽은 행=없음). **2 토글 컬럼 상태**: ON=coral fill+흰 knob 우(x21) / OFF=#DDDDDD track+흰 knob 좌(x3, ≠disabled) / disabled=#ECECEC track+회색 knob #C4C9CF 좌(권한 거부 푸시 컬럼). 컬럼 헤더 정렬=header HF[spacer grow + pushHdr(cbox46 center) + gap16 + inappHdr(cbox46 center)], R pad16이 토글 R pad16과 맞아 46폭 헤더가 46폭 토글 위에 정렬(pd는 pushHdr='권한 필요' dashed pill hug). **trait dot 게이지**(l03 스타일카드)=5 dot10 채움 #3F3F3F·빈 #E4E4E4(뉴트럴, k04 계승·코랄 아님). **D-day pill**: 가까운 여행=coral fill(D-12)·먼 여행=dark #222(D-30, 원본 dark 유지). **BottomTab 마이 active `1236:1150`**(l03만, 저장→기록 override).)
> (2026-07-13 그룹 m Batch 3[m07·m08]에서 등록: **cloud-off**(m07 오프라인 동기화 배너 — 구름+슬래시, 오프라인/동기화 끊김) `<path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6"/><path d="M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3"/><line x1="1" y1="1" x2="23" y2="23"/>` · **logOut**(m08 '이 편집에서 나가기' — 문+화살표, 나가기/이탈) `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`. stroke 2·24 viewBox·round. 재사용: back·chevronR·info·refresh·lock. **오프라인 배너=다크 뉴트럴**(#222 r12 16마진·cloud-off 흰·흰 텍스트 — 원본 full-bleed 다크바→소프트코너 승격, **amber 금지**·다크=뉴트럴-강). **동기화 대기 pill=뉴트럴 회색 dashed**(refresh 아이콘14 muted + Bold12 muted, hairline-strong dash[5,4] — 오프라인 대기 지시자=뉴트럴, **코랄 dot은 m02 라이브 sync 전용**과 대비). **위험 영역 파괴적 행**(m08): slot24 아이콘22 body(lock 종료·logOut 나가기) + 제목 ink + chevron mutedS — **코랄/빨강 0**(파괴적=뉴트럴, 실제 확인 dark 버튼은 dialog). **참여자 요약 아바타=4틴트 spaced**(m02 프레즌스 overlap+링과 달리 정적 목록=gap7 spaced·ring 없음). m07/m08 지도·사진 0.)
> (2026-07-13 그룹 m Batch 1[m01·m02·m03]에서 등록: **userPlus**(m02 empty '아직 동행자 없어요' 히어로 글리프 — 사람+플러스, 동행자 초대 시맨틱) `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>` stroke 1.9·24 viewBox·round·muted-soft(#9AA1AB), dashed 원 히어로(120 r60 #FAFAFA dashed[5,4] #DDD) 안 중앙. 재사용: back·moreH·edit·plus·chevronR·info(§6). **참여자 아바타 4틴트**(다중 사용자 구분, "teal 0"과 별개): 나=코랄(bg#FFE4E9/tx#C13515)·지민=블루(bg#E7F0FB/tx#1B6EF3)·현우=틸(bg#E4F5F1/tx#0E9384)·**서연(4번째)=뉴트럴 슬레이트**(bg#F2F2F2/tx#6A6A6A — 코랄/블루/틸 팔레트 밖 4번째는 뉴트럴, 새 장식 hue 창작 회피). **프레즌스 바**(m02): overlap 아바타 28(itemSpacing −8·흰 stroke2 ring) + 상태 텍스트("지민 편집 중 · 현우 보는 중" body FILL) + **동기화 pill**(surface-soft r999 + **코랄 dot7** + "동기화됨" body — 라이브 동기화=코랄 dot). **편집 중 잠금 카드**(m02 타임라인): 흰 카드 r14 + **코랄 dashed border**(strokes #FF385C·weight1.5·dashPattern[5,4]·그림자 없음) + **✎ 편집 중 배지**(coral-pale #FFE4E9 pill r999 + edit 아이콘14 coral #C13515 + "지민 편집 중" Bold11.5 coral) — 항목 단위 soft-lock 시각화(PRD 동행공동편집 MVP). **역할 배지 pill**: **소유자=coral-pale**(bg#FFE4E9/tx#C13515 Bold — "소유자 배지=코랄" task 규칙) / 편집자·뷰어=뉴트럴 surface-strong(#F2F2F2/muted). 권한 변경 행 우측 '변경 ›'(body+chevronR)·소유자 행=고정('소유자' muted, 액션 없음). **타임라인 스톱**=시간 col(Inter Bold13 ink) + 중립 hollow 원(13 흰 fill·#C2CCD6 stroke2) + 장소 카드(무연결선, m 배치는 지도 아닌 세로 타임라인). m01/m02/m03 지도·사진 0.)

> (2026-07-14 UX 리뷰 대안(페이지 `1630:1083`)에서 등록: **link**(링크 복사 — 공유 시트 대인전송 타일, 체인 링크) `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>` · **globe**(커뮤니티 공개 — 공유 시트 '공개' 행, extLink/share와 별개 '월드/공개' 시맨틱) `<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>`. stroke 2·24 viewBox·round·ink(#222) or body. **공유 시트 3갈래 패턴**(h34-ALT 공유우선): 대인 전송 타일 2개(링크 복사·카카오톡=comment 재사용) 나란히 + 헤어라인 divider + 커뮤니티 공개 행(globe 40 tile+chevronR) **분리 노출** — 대인 '보내기'와 커뮤니티 '공개'를 시각 구분. 코랄은 1급 '공유하기' CTA에만. **공유 상태 용어 통일**(k06-ALT): 되돌리기 액션='공개 중단'(공개 해제/내리기 금지)·상태='비공개로 전환됨'(뉴트럴 pill)·재공개='다시 공개'(코랄 outline)·'취소'는 미커밋 닫기 전용. 공개중 pill=coral-pale, 통계(♥/💬/복제)·비공개 pill=뮤티드.)

> (2026-07-14 c09 온보딩 취향 ALT(단일화면·저부담, 페이지 `1630:1083` · 프레임 `1643:1183`)에서 등록: **activity**(액티비티 스타일 타일 — Feather 심박선) `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>` · **camera**(관광 스타일 타일 — 명소 사진) `<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>` · **zap**(빡빡 페이스 — 번개) `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`. stroke 2·24 viewBox·round. 재사용: sun(휴양)·utensils(미식)·mountain(자연)·image(문화예술)·bag(쇼핑)·moon(느긋)·half-circle(균형, 좌반원 fill=balance)·chevronR·check. **스타일 멀티선택 타일**=흰 카드 r16 + iconCircle 48(선택=coral-pale`#FFE4E9`+아이콘`#C13515` / 미선택=surface-strong`#F2F2F2`+아이콘`#3F3F3F`) + 라벨 Bold14 ink(항상, 라벨은 코랄 안 씀=코랄 최소) + 선택 시 coral 1.5 border + **코랄 체크 배지**(20 원 `#FF385C`+흰 check, layoutPositioning ABSOLUTE 우상 x=w−28·y8·constraints MAX/MIN). 홀수(7개)는 마지막 타일을 full-width(FILL 단독 HORIZONTAL 행) 처리. **페이스 세그 타일**=흰 r12 + 아이콘24+라벨13, 선택('균형' 기본)=coral 1.5 border+아이콘/라벨 `#C13515`·미선택=hairline+아이콘 muted+라벨 body. **'나중에 설정하고 시작' 1급 이탈구**=상단바 우측 Noto Bold14 ink 밑줄(textDecoration UNDERLINE)+chevronR16 — '건너뛰기'보다 강한 카피, 온보딩 저부담 탈출(상태바 9:41 안 그림). 단일 화면=진행 게이지·예산·동행 질문 0, 사진 0(전부 벡터 아이콘 타일). ⚠️함정: createFrame은 currentPage에 자동 attach(layoutMode NONE) → 절대배치 자식은 부모(오토레이아웃)에 **appendChild 먼저, 그 다음** layoutPositioning='ABSOLUTE'. resize()가 primaryAxis를 FIXED로 잠가 hug 붕괴 → 빌드 후 root.primaryAxisSizingMode='AUTO' 재설정으로 내용 hug 복구.)

> (2026-07-15 여행 만들기 2페이지화(g01 `1675:1183`·g02 `1707:1183`, page `1228:1045`)에서 등록: **anchor**(거점=base 코너 태그 — Lucide anchor) `<path d="M12 22V8"/><circle cx="12" cy="5" r="3"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/>` stroke 2.1·24 viewBox·round·흰. **거점 지정 패턴**: 선택 숙소 카드 = 코랄 border 1.5 + 우상단 코랄 pill "⚓ 거점"(흰 anchor14 + "거점" 흰 Bold, 사진 top-right, 이 카드만 ♥ 제거) / 미선택 카드 = ♥ 유지 + 카드 하단 코랄 pin+"거점으로 지정" 텍스트 버튼(전체폭 코랄 fill 행 금지). 숙소 카드 컴팩트 = photo FILL h130 + 이름 Bold15 + "지역·거리" muted(가격·박수 제거). **스텝 인디케이터**(다단계 폼 흐름): appbar/header 우측 layoutPositioning ABSOLUTE 프레임 [seg 14×4 r2 ×2 (완료/현재=coral·미완료=#E0E0E0) + gap6 + "N / 2" Inter Semi Bold12 muted], x=390−16−w·y 세로중앙. g01=1/2·g02=2/2. 슬림·비장식. 다음-단계 CTA=코랄 fill "다음" + 흰 chevronR18(✦ sparkle 제거).)
> (2026-07-14 e 숙소 세부 ALT(페이지 `1630:1083`, 프레임 e01`1699:1185`·e03`1700:1183`·e04`1701:1183`·e04empty`1702:1183`·e05`1703:1183`)에서 등록: **car**(숙소 편의시설 주차 — Lucide car) `<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>` · **wifi**(편의시설 와이파이) `<path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 20 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>` · **waves**(오션뷰 — 물결 3줄) `<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5s2.5 2 5 2 2.5-2 5-2"/><path d="M2 12c.6.5 1.2 1 2.5 1C7 13 7 11 9.5 11s2.5 2 5 2 2.5-2 5-2"/><path d="M2 18c.6.5 1.2 1 2.5 1C7 19 7 17 9.5 17s2.5 2 5 2 2.5-2 5-2"/>`. stroke 2·24 viewBox·round·body(#3F3F3F). 재사용: back·search·share·heart(out/fill)·pin·bed·coffee·extLink·plus·check·info·chevronD·calendar. **숙소 사진 카드**(e01/e04, e02 `1677:1183` 계승)=흰 카드 r16 hairline SHADOW clip + photo(FILL h178~190·IMG) + badge(흰 pill SHADOW_SM 좌상 or 거점=coral solid pill+pin) + ♥(우상: 발견=heart-out translucent / 저장=coral fill) + body(제목 Noto Bold15 + loc·거리 muted13 + ₩ Inter Bold15+`~·1박` muted12). **숙소 상세 히어로**(e03)=hero photo 300h NONE + 흰 원버튼 36(back/share/heart SHADOW_SM 절대 y52) → body(제목 Bold22 + price/loc SPACE_BETWEEN 행) → divider → **편의시설 4타일**(HF layoutGrow=1 균등, tile48 r14 surface-soft+hairline·아이콘24 body·라벨 center12.5) → divider → **위치 미니맵**(§7.5 basemap `7113e88c…` IMG FILL 358×168 r16 + 코랄 bed 티어드롭 핀 중앙[tip=중심] + 축척바·© 우/좌하 + 주소행) → divider → **제휴 고지**(info 아이콘+ "예약·결제는 제휴 파트너 사이트에서" muted) + 코랄 '외부에서 예약하기'(extLink) + outline '일정에 추가'. **리뷰·평점 앱내 표시 0**(외부 위임). **empty 히어로**(e04empty, d04empty `1695:1183` 계승)=회전 없는 사진 클러스터(사진3 overlap·흰 stroke3·SHADOW_SM, 중앙 사진이 z 최상 + 흰 원52 코랄 ♥fill 중앙) + 제목 Bold20 center + 2줄 서브 + 코랄 CTA. **회전 금지**(task) → 사진 fan은 rotation 대신 크기·z·overlap로. **등록 폼**(e05)=제목+검색필드(box hairline r12 + search+값 Bold) + 미니맵 코랄 bed핀 + result 카드(coral-pale bed 타일40+이름/주소) + 날짜필드(calendar+범위+2박, chevronD) + 코랄 '이 숙소 등록'. e-ALT는 이 UX 리뷰 페이지 전용, 원본 `1228:1045` 미접촉.)

> (2026-07-15 c09b 온보딩 취향 2/2(예산·동행·음식·이동, page `1228:1045` · 프레임 `1774:2258` @ (5850,4800))에서 등록: **heart(outline)**(동행 '연인' 타일 — §6 heart(fill)의 stroke 버전, ♥ 코랄필과 구분) `<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>` · **family**(동행 '가족' — 부모+아이, users[동등 2인]와 구분되는 크기 다른 2인) `<circle cx="8" cy="7" r="3"/><path d="M2.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.2"/><path d="M15 20a3.8 3.8 0 0 1 6.5-2.6"/>` · **footprints**(이동 '도보 위주' — Lucide 발자국 2개) `<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/>`. stroke 2·24 viewBox·round. 재사용: user(혼자)·transit(⇄ 대중교통, i09 교통 계승)·car(차량, e-ALT)·check(코랄 배지). **점 스텝 인디케이터**(다단계 온보딩 상단, g01/g02 seg 인디케이터의 dot 변형)=topBar를 SPACE_BETWEEN으로 두고 index0에 삽입: [dots(HF gap6) ● ellipse8 완료/현재=coral·미완료=#E0E0E0] + gap8 + "N / N" Inter Semi Bold12 muted. 1643=1/2(dot1 coral·dot2 grey)·1774:2258=2/2(둘 다 coral). 우측 '나중에 설정하고 시작'(상단/하단 스킵) 유지. **예산 텍스트 카드**(아이콘 없이 2×2, 하나 선택)=흰 r16 hairline(선택 coral1.5) + 제목 Noto Bold15 + 금액 Noto Regular12.5(선택=둘 다 #C13515) + 코랄 check 배지(선택만, ABSOLUTE MAX/MIN x=w−28 y8). 금액에 '만원' 한글 포함 → Inter 아닌 **Noto**(Inter는 한글 tofu). c09(1/2)=관심사·페이스, c09b(2/2)=예산·동행·음식·이동으로 온보딩 취향 2페이지 분리. c09b는 원본 `1228:1045` 정본 페이지에 빌드(1643 clone 후 body 교체·비파괴). 온보딩=하단 탭바 없음.)

> (2026-07-15 i 통합 여행중 2뷰(일정 `1658:1183`·지도 `1782:2258`, page `1228:1045`)에서 등록: **locate**(GPS·실시간 현재 위치 — Lucide locate-fixed. 지도 '현재 위치' pill 앞 소형 아이콘, GPS 뉘앙스) `<circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="4.5"/><line x1="12" y1="19.5" x2="12" y2="22"/><line x1="2" y1="12" x2="4.5" y2="12"/><line x1="19.5" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="2.2" fill="{c}" stroke="none"/>` stroke 2.2·24 viewBox·round·**coral #C13515**(현재위치 pill 텍스트색과 일치). 11px 소형, pill 좌측 itemSpacing3.5·counterAxisAlignItems CENTER. **뷰 토글 세그먼트**([일정][지도] 여행중 2뷰)=container #EDEDED r12 p4, 세그 FILL 균등, **active=코랄 solid #FF385C+흰 Bold14+SHADOW_SM** / inactive=투명+muted Regular14(§8 세그의 코랄-solid 변형=1차 뷰 전환, 회색 필터 세그와 위계 구분). **컴팩트 day switcher**(멀티데이 이동, topBar title 아래 슬림 칩행)=[1일차·2일차·3일차] HORIZONTAL hug gap8, **active=coral-pale pill(#FFE4E9/#C13515 Bold13, no border)** / inactive=투명+hairline-strong(#DDD) 1px outline pill+body(#3F3F3F Regular13), px12 py5 r999. **위계 3층**: 뷰 토글=coral solid(1차) · day/filter=coral-pale(2차) · outline=inactive. **지도 뷰 map-first + peek**: map 히어로(390×250 NONE, i02 basemap paint 재사용) + 하단 슬림 peek(헤더 'DayN·남은 N곳'+'전체 일정 ›' / [지금]coral-pale pill·[다음]neutral pill + 장소 Bold14 + 우측 상태·거리 muted). 완료핀=coral solid teardrop·현재=solid+coral ring46+현재위치 pill·예정=ghost(흰+#9AA1AB dashed+muted 숫자). 동선=완료구간 coral solid·예정구간 coral dashed[6,5] op0.5(§8 직선 규칙).)
> (2026-07-15 #2 i 통합본 UX 적용 밴드(신규 y=21600, 정본 `1228:1045`)에서 등록: **여행중 컨텍스트 헤더 2종(그룹 통일용)**. **Variant A**(코어 탭 뷰=일정/지도/GPS·트리거칩): VERTICAL padTop16 side16 padBottom10 gap2 흰 — 제목 `부산 여행 · 2일차`(Noto Bold20 ink) + 부제 `6월 11일 수요일 · 오늘 일정`(Regular13 muted #6A6A6A), **back 없음**(탭 목적지) + day switcher + [일정][지도] 세그 + BottomTab(일정 active). **Variant B**(서브플로우·디테일=사유/분기/대안/확정/폴백·현장 디테일): VERTICAL padTop14 side16 padBottom12 gap3 흰 — ctxrow(HORIZONTAL FILL center: [back‹ 24 stroke#222] + eyebrow `부산 여행 · 2일차` Noto Bold12.5 **coral #C13515** ; 우측 액션 아이콘 share 등은 leftGroup layoutGrow=1로 밀어냄) + 화면 제목(Bold20 ink). **BottomTab 없음**(액션 CTA 유지). 위계: eyebrow coral = "여행·일차 맥락은 항상 고정"(2차 강조). **리트로핏 메커닉(비파괴 클론 밴드)**: `src.clone()`→`P.appendChild`→x/y/name(재클론=옛 id 삭제→get_metadata 재파싱으로 신규 id) → 헤더 교체=`frame.insertChild(0,newHeader)`→`layoutSizingHorizontal='FILL'`→`old.remove()`(old는 캡처해 둔 child[0]). **여행중 트리거 배너**(i08 인앱칩): coral-pale #FFE4E9 r12 배너(HORIZONTAL FILL, side16 흰 wrap) — cloud-rain 아이콘 coral #C13515 + col(제목 Bold13 + 서브 Regular11.5, 둘 다 #C13515, layoutGrow=1) + chevronR coral + ✕ coral, topBar와 timeline 사이 insertChild(1). **상태어 통일**: 라이브 진행 pill `지금`→`진행 중`. **empty 아이콘 코랄화**: 회색 원→coral-pale #FFE4E9 + 알림 vector stroke→coral #C13515(회색 blob 금지, 킷 5원칙). **태그/해시 칩 오프킷 정리**: 라벤더·보라 pill→뉴트럴(bg #F2F2F2 + text #3F3F3F body, 코랄 1색 규율). day 라벨=`1일차/2일차/3일차` 통일(`Day1/2박 체류` 금지). QA=figma-qa(구 airbnb-hifi-qa) 20/20 PASS. 잠금화면 푸시(i07)=플랫 이미지라 텍스트 편집 불가·앱크롬 없음이 의도.)

### 아이콘이 목록에 없을 때 (확장 규칙 — 일관성이 핵심)
1. **스타일 고정.** 24×24 viewBox·stroke 1.9~2.2·`fill=none`(면 아이콘 제외)·`stroke-linecap/join=round`. Lucide/Feather 지오메트리를 따른다. 이모지·글리프·두꺼운 필·다른 그리드를 섞지 않는다.
2. **레지스트리 우선.** 필요한 아이콘이 위 목록(또는 Figma Icon 컴포넌트)에 있으면 그대로 쓴다. 같은 아이콘을 매번 새로 그리지 않는다.
3. **없으면 → 그린 뒤 등록.** 표준 Lucide path를 재현해 그리고 get_screenshot으로 확인한 다음, **반드시 이 §6 목록(및 파운데이션 Icon 컴포넌트)에 추가**한다. 등록해야 다음 화면부터 동일하게 재사용된다(화면마다 다른 모양 방지).
4. **애매/복잡하면.** 더 단순한 대체 아이콘을 쓰거나 오케스트레이터에 확인한다. 임의 창작·저품질 패스 금지.
5. **파운데이션 Icon 컴포넌트 세트(28종) `1237:1159`.** 있는 아이콘은 인스턴스로 배치 → 픽셀 동일. 신규 등록 아이콘도 세트에 추가한다(세트 실재는 2026-07 기록 기준 — 라이브에서 못 찾으면 SVG 인라인).

---

## 7. 부산 사진 imageHash (파일에 영구 임베드·컬러 그대로 재사용)
```
감천문화마을 ef11b3dd89eda571f1296af75bbae6c3da6330e4
광안리 해변  1d586cdbaa5ecb972b768a36cf228568a9b21461
해운대 해변  525b2711587599559d5c52bcc839e26adb078aa2
부산 야경    c89827197a70f5b157b8947039db97c913c55f6c
카페·커피    495af05bfd6e2d063f11d7fd2cc7d47381a520a5
해동용궁사   c3952fa10d3e07a4f289789dbc8ecad17370806a
자갈치 시장  4917f53a8f472caf6df252563820b7f0d31e6630
```
아바타 얼굴 사진은 없음 → 이니셜 원(코랄/블루/틸 틴트)로 대체. 새 지역 사진 필요 시 upload_assets(다운로드+POST 동일 Bash) 후 이 표에 추가.

### 7.1 한국 도시 사진 (2026-07-16 등록 — 지역 선택 화면용, Wikimedia CC)
```
경주(동궁·월지 야경) e3ae0df9e75f6f1096c5171bbf54377aa400ee6d   node 1830:1083
서울(경복궁)         9a62f7186ca864e0abad3286db90e7baa325901f   node 1831:1083
제주(성산일출봉)      74b693fdfd6f04f4f7dcaee97b4b633804e88b6c   node 1831:2284
강릉(경포대 해변)     cee4f1d5f05f46d7c600e10c21ff1c9d84888273   node 1831:2285
여수(여수 밤바다)     cc16851c1408b69fb2da5e1172bb1fcb708978a5   node 1831:2286
```
⚠️ **이 신규 해시는 `IMG(hash)`/`figma.getImageByHash()`로 안 잡힐 수 있음**(upload_assets nodeId 경로 버그). **안전한 사용 = ASSET_SCRATCH 페이지 `1826:1083`의 임시 rect 노드(위 node id)에서 `photo.fills=[srcNode.fills[0]]`로 fill 복사.** 부산 7종(§7)은 검증된 해시라 `IMG(hash)` 그대로 OK. ⚠️ `upload_assets` nodeId 동작은 두 기록이 충돌한다(fill 미부착 vs 직접 세팅, §9) — **실측 전까지 안전 경로 = ASSET_SCRATCH fill 복사.** 실측 후 이 줄과 §9를 하나로.

### 7.5 지도 (임시 — 공급자 전환 예정)
실 앱 지도는 카카오맵 웹뷰이고 **네이버맵으로 전환 예정**(사용자 결정, 상세는 하네스 변경이력). Figma의 지도 이미지는 그 사이의 임시 콘텐츠다.
- 새 화면의 지도는 **자매 화면(같은 밴드 신세대 프레임)의 지도 노드를 복제**해 쓴다. 출처 표기도 자매를 따른다. **지도 출처 표기(© CARTO / © Kakao)는 세대 판정 축이 아니다** — 공급자가 바뀌는 중이라 신뢰하지 않는다.
- 타일 = '사진 콘텐츠' 취급 → 코랄 1색 규율 유지(강조는 핀·동선만). 동선 = 스톱 순서 **직선**(§8), 도로경로·곡선 금지.
- 구 CartoDB 타일 파이프라인(`genmap.py`)은 폐기했다(Researr 아카이브). 등록된 베이스맵 imageHash(재사용 가능): 부산 도시전체 `7113e88c3fd918b34ade65734062370cf47cc9bd` · 부산 1일 동선 데모 `6de6e555b029c00eab9c509dd5bdfab3344dfb31`.

---

## 8. 컴포넌트 레시피 (핵심 요소 — Variables 바인딩 대상은 Figma 컴포넌트로, 나머지는 아래 코드 패턴)
- **하단탭 nav(active idx 0~4)**: 390×74, 상단 헤어라인(strokeTopWeight=1), 5탭 FILL 균등, 아이콘24+라벨11(활성=Bold 코랄+채움아이콘, 비활성=Regular muted+stroke). ⚠️ layoutMode 설정이 폭을 HUG로 바꾸므로 `nav.layoutSizingHorizontal='FILL'`을 **마지막에 재설정**.
- **히어로 photo 카드**: VERTICAL 카드(흰·hairline·SHADOW·radius16·clip) → photo(FILL·FIXED h150·IMG) + 흰 pill 배지(x/y 절대, 사진은 layoutMode NONE) + body(제목 Noto Bold20 + 메타 muted + progress + 코랄 CTA).
- **숙소/장소 카드**: photo(FILL·rounded14) + ♥(우상 x/y) + 배지(좌상) → meta행(제목 + 별점 I Bold13) → loc muted → 가격 I Bold15 + `/박` muted.
- **pill 검색바**: HORIZONTAL·rounded999·흰·hairline·SHADOW, search아이콘 + 텍스트칼럼(값 Bold + 서브 muted) + 필터 원버튼.
- **칩**: rounded999 padding 14×8. 선택=코랄fill 흰텍스트 / 미선택=흰+hairline+ink. primaryAxisSizingMode='AUTO'.
- **버튼**: primary=코랄fill·on-primary·radius12·h48~54 / secondary=흰·hairline·ink / text=코랄텍스트.
- **입력 필드**: 라벨(muted Bold13) 위 + box(흰·hairline·radius12·padding14) [아이콘 + 값 Bold + chevronD].
- **세그먼트**: 컨테이너 `#EDEDED` radius12 padding4, 세그 FILL, 활성=흰+SHADOW+ink Bold / 비활성=투명+muted.
- **대화 버블**: row(FILL, primaryAxisAlignItems MIN=AI/MAX=유저) > bubble(HUG·maxWidth 286·radius16, AI=`#F2F2F2`(surface-strong)/유저=`#222`) > text FILL·textAutoResize HEIGHT.
- **통계 타일 3분할**: HORIZONTAL gap10, 타일 FILL·VERTICAL center(숫자 I Bold20 코랄/ink + 라벨 muted).
- **지도 (§7.5 — 자매 화면 지도 노드 복제 또는 등록 imageHash 임베드)**: ① 맵 프레임(size, layoutMode NONE, **aspect = 이미지 aspect**) → `upload_assets(nodeId=맵프레임, scaleMode FILL)` + Bash raw POST로 베이스맵 채움. ② **동선 = 직선만**(사용자 결정 2026-07-12). 순서대로 스톱을 잇는 **straight 직선 세그먼트**(코랄 #FF385C w2.5~3, round cap; 흰 casing w6 밑) — Vector `vectorPaths`("M x0 y0 L x1 y1 L …" 스톱 좌표만) 또는 createLine. **OSRM 도로경로·곡선 금지**(`route_norm`은 이제 안 씀). **거점 숙소·필수 방문지 지도는 연결선 아예 없음**(핀만, 동선 X). ③ 핀 = `stops` norm×size: **일정 스톱/일반 POI = 코랄 번호·글자 티어드롭**(흰 숫자 Inter Bold·흰 링·그림자, 팁이 좌표). **숙소(거점) 마커 = 코랄 핀 + 흰 `bed` 아이콘(§6)** — "숙" 텍스트 네모 금지, POI와 시각적으로 구분. 핀은 동선 위 z. ④ 축척바(우하) + "© OpenStreetMap · CARTO"(좌하 muted 9px). 지도-우선 화면은 상단 세그[지도|시간표] + 하단 코스 peek 카드.

---

## 9. 운영 함정 (이 파일 고유 — `use_figma` 일반 규칙은 `figma-use` 스킬이 정본)
`use_figma` 일반 규칙(**`return`이 유일한 출력 채널**·`figma.notify` throw·페이지 전환 호출당 1회·≤10 오퍼레이션·atomic·폰트 로드 레시피·sizing enum·pre-flight 체크리스트)은 공식 `figma-use` 스킬(`frontend/.claude/skills/figma-use/SKILL.md`)을 따른다. 이 절은 **이 파일에서만** 겪는 것.
- **페이지**: `const P=await figma.getNodeByIdAsync('1228:1045'); if(!P||P.type!=='PAGE') throw new Error('BAD PAGE'); await figma.setCurrentPageAsync(P);` — **이름 가드 금지**(이름이 `Airbnb 하이파이`→`화면`으로 바뀜). `figma.root.children`·`get_metadata` 페이지 열거는 stale이라 이 페이지가 안 뜬다(이름 검색으로 엉뚱한 페이지에 그린 사고 이력).
- **반환**: `return {createdNodeIds, mutatedNodeIds}`. 구 킷의 "throw로 값 반환 금지 → `figma.notify`로 끝내라"는 **폐기**(notify는 not implemented throw).
- **폰트**: Noto Sans KR(Regular·Bold)·Inter(Regular·Semi Bold·Bold)만. Pretendard·Apple SD·Noto Medium 로드 실패. 텍스트 fills 변경은 폰트 로드 불필요, `characters` 설정은 fontName 먼저.
- **이미지**: `createImageAsync` 미지원. 새 이미지는 `upload_assets` raw POST(`curl -X POST --data-binary @file -H "Content-Type: image/png"`). nodeId 지정 동작은 §7 참고(충돌 기록) — 안전 경로 = ASSET_SCRATCH `1826:1083` fill 복사. 맵 프레임 aspect ≠ 이미지 aspect면 FILL 왜곡/크롭.
- **오토레이아웃**: `resize()` 먼저, `layoutSizing*` 나중(resize가 FIXED로 리셋). `layoutMode` 설정 시 primaryAxisSizingMode가 HUG로 바뀌어 **하단탭 폭이 112px로 붕괴** → FILL 재설정(QA F의 그 증상). 빈 auto-layout 프레임은 ~100px 미수축(스페이서 금지). `marginTop/Bottom` 미지원(padding/spacer).
- **절대배치**: ABSOLUTE는 부모 auto-layout일 때만. 사진 위 배지는 부모 layoutMode NONE + x/y.
- **인스턴스**: 자식 resize/재색 막힘 → detach(id가 바뀌므로 안정 부모에서 재탐색). 다중 꺾은선은 `createLine`+`relativeTransform`이 `vectorPaths`보다 안정.
- **밴드**: 정본 밴드 x 간격 **450**, 원점 음수(a −46·i −92·j~m −122) — `x≥0` 필터는 첫 프레임을 놓친다. 끝에만 붙이고 중간 삽입 금지(뒤 전부 리플로우). 스트립 밖 노드는 `get_screenshot`이 1×1 → 좌표로 검증. 사진 페인트는 트리 순회가 아니라 id로 수집.
- **지도·마커**: 마커 수 = 후보 수(같은 배열로 구동, 고립 마커 = FAIL). 긴 본문 텍스트는 FILL(고정폭 금지). head(배지+제목) 행은 상단 정렬(`counterAxisAlignItems='MIN'`).

---

## 10. 설계 결정 (사용자 확정 — 새 화면·수정안은 이 안에서 움직인다)
- **상태를 페이지로 만들지 않는다.** '담은 곳'·'방문함'·'수정'은 상태/모드이지 목적지가 아니다 → 그것을 유발한 표면(카드·알약·인라인)으로 접는다. 화면을 더하는 게 아니라 빼는 방향.
- **역할 분리**: 편집 화면 = 조작만 / 일정 화면 = 경고·사실 / AI 경로 = 판단. 편집 화면에 변수 경고를 넣지 않는다.
- **수정 진입 = 우하단 알약**(홈 `fabExtended`/`fabSaved` 2단 어휘) → `직접 수정` / `AI에게 맡기기`(사유 컴포저). 변수 감지도 같은 알약. **변수 전용 화면 없음.** 알약 펼침은 스크림 없음, 입력 시트는 스크림 있음.
- **담은 곳의 주인 = 홈 + 탐색**(일정 탭 소유안 폐기). 저장의 단일 주인은 히어로 우상단 하트(하단바 `♥ 저장` 없음). 카운트는 알약 한 자리에만.
- **하단 탭 숫자 뱃지 금지** — 위시리스트는 소멸성이 없어 긴박감을 빌려오는 것이다.
- **되돌리기는 토스트 수명에 묶지 않는다** — 영속 경로(카드 `방문 취소` 등)를 둔다.
- **이식은 정본 기준** — 수정본에서 배운 것만 옮긴다(정본에만 있는 자산 회귀 방지). 수정본이 정본의 상위집합일 때만 이동 교체.
- 미결(손대지 말고 알린다): h25·h30 FAB 3단이 카드 액션 라벨을 덮음 — FAB 개수 축소는 설계 결정 대기. h25 계열 거리 산술 불일치(§traps).
