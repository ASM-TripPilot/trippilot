import Svg, { Circle, Path } from 'react-native-svg';

// 숙소 검색 결과(e02) 전용 인라인 벡터 글리프(AuthGlyphs/OnboardingGlyphs/HomeGlyphs 패턴
// 계승 · Figma 1837:2283). features 간 직접 import 금지(importBoundary 의도 — features/stay는
// eslint FEATURES 목록 밖이라 기계 강제는 없지만, 02a T-16 판정대로 이 리포 관례를 따른다)라
// HomeGlyphs의 하트·OnboardingGlyphs의 뒤로가기 셰브론을 가져다 쓰지 않고 이 파일에 새로
// 그린다. 색은 이 파일 안에서만 raw hex로 고정한다(선례 — `ui/` 안이지만 `*Screen.tsx`
// 파일명 필터 밖이라 V1(raw-hex 가드) 대상이 아니다, 02a §6 판정②).

const INK = '#222222';
const BODY = '#3F3F3F';
const MUTED = '#6A6A6A';
const PRIMARY = '#FF385C';
const MUTED_SOFT = '#9AA1AB';
const ON_PRIMARY = '#FFFFFF';

type GlyphProps = {
  size?: number;
  testID?: string;
};

// 앱바 뒤로가기(AC-10) — 표시만, 실동작 미배선(이번 범위 밖 — FAB·탭바와 같은 등급).
export function BackChevronGlyph({ size = 24, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M15 18L9 12L15 6"
        stroke={INK}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 필터 칩 '가격대'·'지역' 드롭다운 셰브론.
export function ChevronDownGlyph({ size = 14, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
    >
      <Path
        d="M3.5 5.5L7 9L10.5 5.5"
        stroke={BODY}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 필터 칩 '필터'(⇥) — 가로 슬라이더 2줄(각 줄에 조절 노브 하나, Figma 1837:2291 재작도).
// 필터 칩(15px, tone 미지정 = body)과 filter-zero 원형 배지(32px, tone='primary')가 같은
// 도형을 다른 색으로 쓴다 — WarningTriangleGlyph와 같은 형태로 색만 prop으로 뺀다.
// 기본값을 body로 두는 이유: 칩이 먼저 이 글리프를 쓰고 있었고, 그 색이 바뀌면 안 된다.
export function FilterSlidersGlyph({
  size = 14,
  tone = 'body',
  testID,
}: GlyphProps & { tone?: 'body' | 'primary' }) {
  const stroke = tone === 'primary' ? PRIMARY : BODY;
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
    >
      <Path
        d="M2 4.5H12"
        stroke={stroke}
        strokeWidth={1.3}
        strokeLinecap="round"
      />
      <Circle cx={5} cy={4.5} r={1.7} fill={stroke} />
      <Path
        d="M2 9.5H12"
        stroke={stroke}
        strokeWidth={1.3}
        strokeLinecap="round"
      />
      <Circle cx={9} cy={9.5} r={1.7} fill={stroke} />
    </Svg>
  );
}

// 경고 삼각형(TRIP-182 §3-7) — partial 배너(20px·tone='ink') · error 배지(32px·
// tone='primary') 겸용. 벡터는 Figma 1343:1429(배너, ink)·1344:1455(error, primary)에서
// 그대로 추출했다 — 두 노드는 좌표 비율이 완전히 같은 도형이라(20 grid ↔ 32 grid 스케일만
// 다름) 하나의 viewBox·path에 size prop만 바꿔 겸용한다.
export function WarningTriangleGlyph({
  size = 20,
  tone = 'ink',
  testID,
}: GlyphProps & { tone?: 'ink' | 'primary' }) {
  const color = tone === 'primary' ? PRIMARY : INK;
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M10 2.5L18.3333 16.6667H1.66667L10 2.5Z"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 7.5V11.6667"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 14.1667H10.0083"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 위치 핀(TRIP-182 §3-2) — empty 배지 32px, 분홍. Figma 1341:1378 벡터 그대로.
// tone: 분홍(기본, e02 empty 배지)과 먹색(e04 하단 "거점 지정" 버튼 핀 — 흰 버튼 위라 텍스트와
// 같은 먹색) 겸용. FilterSlidersGlyph·WarningTriangleGlyph 의 tone 선례와 동형(색만 prop 으로).
// 기본값을 primary 로 두는 이유: 기존 호출부(StaySearchScreen·StayDetailScreen)가 이 색을 쓴다.
export function MapPinGlyph({
  size = 32,
  tone = 'primary',
  testID,
}: GlyphProps & { tone?: 'primary' | 'ink' }) {
  const color = tone === 'ink' ? INK : PRIMARY;
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
    >
      <Path
        d="M26.6667 13.3333C26.6667 21.3333 16 29.3333 16 29.3333C16 29.3333 5.33333 21.3333 5.33333 13.3333C5.33333 10.5044 6.45714 7.79125 8.45753 5.79086C10.4579 3.79047 13.171 2.66667 16 2.66667C18.829 2.66667 21.5421 3.79047 23.5425 5.79086C25.5429 7.79125 26.6667 10.5044 26.6667 13.3333Z"
        stroke={color}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16 17.3333C18.2091 17.3333 20 15.5425 20 13.3333C20 11.1242 18.2091 9.33333 16 9.33333C13.7909 9.33333 12 11.1242 12 13.3333C12 15.5425 13.7909 17.3333 16 17.3333Z"
        stroke={color}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 돋보기 — e04 empty CTA `숙소 둘러보기`(19, 분홍 버튼 위 흰색 ON_PRIMARY, Figma 1702:1183) 와
// e02 검색바(20, 회색 MUTED_SOFT, Figma 2488:1500) 겸용. 색만 tone prop 으로 뺀다(SearchGlyph 를
// 두 벌로 나누지 않는다 — FilterSlidersGlyph tone 선례). 기본값 onPrimary: e04 가 먼저 이 색을 썼다.
// TripGlyphs 에 동명 그림이 있으나 features 간 직접 import 금지(리포 관례)라 새로 그린다.
export function SearchGlyph({
  size = 19,
  tone = 'onPrimary',
  testID,
}: GlyphProps & { tone?: 'onPrimary' | 'mutedSoft' }) {
  const stroke = tone === 'mutedSoft' ? MUTED_SOFT : ON_PRIMARY;
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M9.16667 15C12.3883 15 15 12.3883 15 9.16667C15 5.94501 12.3883 3.33333 9.16667 3.33333C5.94501 3.33333 3.33333 5.94501 3.33333 9.16667C3.33333 12.3883 5.94501 15 9.16667 15Z"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M17.5 17.5L13.75 13.75"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 플러스 — 수동 등록 유도 카드 배지(22, 분홍 PRIMARY, 연분홍 원 위, Figma 1341:1391) ·
// e02 분홍 원 FAB(24, 흰색 ON_PRIMARY, Figma 4463:2113) · e03 CTA2 "일정에 추가"(19, 흰 버튼 위라
// 먹색 INK, Figma 1700:1278) 겸용. 색만 tone prop 으로 뺀다(SearchGlyph tone 선례). 기본값
// primary: 등록 카드가 먼저 이 색을 썼다(무prop 호출 무회귀).
export function PlusGlyph({
  size = 22,
  tone = 'primary',
  testID,
}: GlyphProps & { tone?: 'primary' | 'onPrimary' | 'ink' }) {
  const stroke =
    tone === 'onPrimary' ? ON_PRIMARY : tone === 'ink' ? INK : PRIMARY;
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
    >
      <Path
        d="M11 4.58333V17.4167"
        stroke={stroke}
        strokeWidth={2.38333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4.58333 11H17.4167"
        stroke={stroke}
        strokeWidth={2.38333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 수동 등록 유도 카드 우측 셰브론(TRIP-182 §3-2) — 20px, muted-soft. Figma 1341:1397 벡터 그대로.
export function ChevronRightGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M7.5 5L12.5 10L7.5 15"
        stroke={MUTED_SOFT}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 카드 저장 하트 — 미저장(외곽선). TRIP-181까지는 이 화면의 유일한 하트였다(AC-7 정직한 스텁).
// ponytail: 회색 플레이스홀더 전제, 실사진 붙으면 흰색으로 되돌린다
export function HeartOutlineGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
    >
      <Path
        d="M11 19C11 19 3 14 3 8.6C3 5.9 5.1 3.8 7.7 3.8C9.1 3.8 10.4 4.5 11 5.6C11.6 4.5 12.9 3.8 14.3 3.8C16.9 3.8 19 5.9 19 8.6C19 14 11 19 11 19Z"
        stroke={MUTED}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// e03 hero 공유 아이콘(TRIP-457) — 표시만(공유 계약 미존재, 범위 밖 — FAB·탭바 등급의 정적
// 어포던스). Figma 1700:1194 벡터 근사.
export function ShareGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M6.5 11.5L13.5 15M13.5 5L6.5 8.5"
        stroke={INK}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M15 6.5C16.1046 6.5 17 5.60457 17 4.5C17 3.39543 16.1046 2.5 15 2.5C13.8954 2.5 13 3.39543 13 4.5C13 5.60457 13.8954 6.5 15 6.5Z"
        stroke={INK}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5 12C6.10457 12 7 11.1046 7 10C7 8.89543 6.10457 8 5 8C3.89543 8 3 8.89543 3 10C3 11.1046 3.89543 12 5 12Z"
        stroke={INK}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M15 17.5C16.1046 17.5 17 16.6046 17 15.5C17 14.3954 16.1046 13.5 15 13.5C13.8954 13.5 13 14.3954 13 15.5C13 16.6046 13.8954 17.5 15 17.5Z"
        stroke={INK}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// e03 인라인 제휴 고지(TRIP-457) — 정보 원(ⓘ). Figma 1700:1266 벡터 근사. muted.
export function InfoGlyph({ size = 15, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Path
        d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 7.3V11M8 5H8.008"
        stroke={MUTED}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// e03 1차 CTA(외부에서 예약하기) — 외부 링크(상자 밖 화살표), 분홍 버튼 위라 흰색. Figma 1700:1272.
export function ExternalLinkGlyph({ size = 19, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M11 3H17V9"
        stroke={ON_PRIMARY}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M17 3L9 11"
        stroke={ON_PRIMARY}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M15 12.5V15.5C15 16.0523 14.5523 16.5 14 16.5H4.5C3.94772 16.5 3.5 16.0523 3.5 15.5V6C3.5 5.44772 3.94772 5 4.5 5H7.5"
        stroke={ON_PRIMARY}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// e03 편의시설 칩 아이콘(TRIP-457) — 서버 코드가 임의라 코드별 아이콘을 지어내지 않고(INV-1)
// 하나의 일반 체크 배지로 그린다. 색은 6-b 실기 몫(★F-10, 글리프 fill은 jest 무심판).
export function AmenityGlyph({ size = 24, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M20 6L9 17L4 12"
        stroke={BODY}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// e03 편의시설 아이콘 4종(TRIP-727) — 서버 코드가 아는 값(주차·조식·와이파이·오션뷰)일 때만
// 코드별 그림을 그린다(모르는 값은 `resolveAmenityIcon`이 AmenityGlyph 폴백으로 접는다, INV-1).
// 매핑표는 `features/stay/config/amenityIcons.ts`. 색은 6-b 실기 몫(글리프 fill/stroke jest 무심판).

// 주차 — 자동차 실루엣.
export function ParkingGlyph({ size = 24, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M5 14L6.6 8.6C6.8 7.9 7.4 7.5 8.1 7.5H15.9C16.6 7.5 17.2 7.9 17.4 8.6L19 14"
        stroke={BODY}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4 14H20V16.5C20 16.8 19.8 17 19.5 17H4.5C4.2 17 4 16.8 4 16.5V14Z"
        stroke={BODY}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={7.5} cy={17} r={1.3} fill={BODY} />
      <Circle cx={16.5} cy={17} r={1.3} fill={BODY} />
    </Svg>
  );
}

// 조식 — 커피 컵(김 세 줄).
export function BreakfastGlyph({ size = 24, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M5.5 8.5H16.5V13C16.5 15.2 14.7 17 12.5 17H9.5C7.3 17 5.5 15.2 5.5 13V8.5Z"
        stroke={BODY}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16.5 9.5H18.5C19.6 9.5 20.5 10.4 20.5 11.5C20.5 12.6 19.6 13.5 18.5 13.5H16.5"
        stroke={BODY}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 4V6M12 4V6M15 4V6"
        stroke={BODY}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 와이파이 — 세 겹 아치 + 점.
export function WifiGlyph({ size = 24, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M4 9.5C8.5 5 15.5 5 20 9.5"
        stroke={BODY}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M7 12.5C10 9.7 14 9.7 17 12.5"
        stroke={BODY}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 15.5C11.2 14.4 12.8 14.4 14 15.5"
        stroke={BODY}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={18} r={1} fill={BODY} />
    </Svg>
  );
}

// 오션뷰 — 물결 세 줄.
export function OceanViewGlyph({ size = 24, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M3 7C4.5 5 6 5 7.5 7C9 9 10.5 9 12 7C13.5 5 15 5 16.5 7C18 9 19.5 9 21 7"
        stroke={BODY}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3 12C4.5 10 6 10 7.5 12C9 14 10.5 14 12 12C13.5 10 15 10 16.5 12C18 14 19.5 14 21 12"
        stroke={BODY}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3 17C4.5 15 6 15 7.5 17C9 19 10.5 19 12 17C13.5 15 15 15 16.5 17C18 19 19.5 19 21 17"
        stroke={BODY}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 카드 저장 하트 — 담김(채움, TRIP-417). 같은 22-viewBox path를 분홍(PRIMARY)으로 채운다 —
// 빈/찬을 색으로 재는 것은 jest 무심판(repo-trap: `*Glyphs.tsx` fill은 렌더 트리에 안 남는다)이라,
// 상태는 이 별도 컴포넌트(=다른 testID) + Pressable의 accessibilityState.selected 두 신호로 잰다.
export function HeartFilledGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
    >
      <Path
        d="M11 19C11 19 3 14 3 8.6C3 5.9 5.1 3.8 7.7 3.8C9.1 3.8 10.4 4.5 11 5.6C11.6 4.5 12.9 3.8 14.3 3.8C16.9 3.8 19 5.9 19 8.6C19 14 11 19 11 19Z"
        fill={PRIMARY}
        stroke={PRIMARY}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
