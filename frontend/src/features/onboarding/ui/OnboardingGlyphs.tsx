import type { ComponentType } from 'react';
import Svg, { Path } from 'react-native-svg';

// 온보딩(약관·닉네임) 전용 벡터 글리프(TRIP-162 c06/c07 Figma 정합). Figma 에서 내려받은
// .svg 좌표를 react-native-svg 프리미티브(<Svg><Path/>)로 1:1 옮긴다 — AuthGlyphs.tsx 와
// 같은 인라인 방식(transformer 미도입). 위치(c08) 화면은 별도 파일(shared/location/LocationGlyphs)을
// 쓴다 — features 간 직접 import 금지(importBoundary)라 화면끼리 글리프를 공유하지 않는다.

type GlyphProps = {
  size?: number;
  testID?: string;
};

// 내비바 back chevron — 표시만(장식), 실동작 미배선(Q3 비목표). terms·nickname 공용.
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
        stroke="#222222"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 체크박스 체크 표시(흰색) — 약관 checked 상태 안에 얹는다(T5·T6).
export function CheckGlyph({ size = 14, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
    >
      <Path
        d="M11.6666 3.5L5.24992 9.91667L2.33325 7"
        stroke="#ffffff"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// "보기 ›" 옆 chevron(T3·AC-T5).
export function ViewChevronGlyph({ size = 16, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Path
        d="M6 4L10 8L6 12"
        stroke="#9AA1AB"
        strokeWidth={1.46667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 닉네임 재생성 원형 화살표(입력창 내부 아이콘, primary tint) — N4.
export function RegenerateGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
    >
      <Path
        d="M18.3334 10.0834C18.2625 8.35022 17.5795 6.69829 16.4058 5.42107C15.232 4.14386 13.6436 3.32405 11.9225 3.1073C10.2015 2.89054 8.45937 3.29088 7.0056 4.23717C5.55183 5.18347 4.48057 6.61447 3.98213 8.27594C3.48369 9.9374 3.59034 11.7218 4.28314 13.312C4.97594 14.9023 6.21002 16.1955 7.76616 16.9619C9.3223 17.7283 11.0997 17.9183 12.7827 17.4981C14.4656 17.0778 15.9452 16.0747 16.9584 14.6667"
        stroke="#FF385C"
        strokeWidth={1.83333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M18.3332 3.6665V10.0832H11.9165"
        stroke="#FF385C"
        strokeWidth={1.83333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 닉네임 긍정 상태 초록 체크(info tint) — N5·AC-N3.
export function PositiveCheckGlyph({ size = 16, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Path
        d="M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14Z"
        stroke="#0B6E63"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5.66675 8.3335L7.33341 10.0002L10.6667 6.3335"
        stroke="#0B6E63"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ── 취향 온보딩(c09/c09b) 전용 글리프(TRIP-163) ──────────────────────────
// 카드/칩 아이콘은 "선택 여부"에 따라 stroke 색이 바뀐다(회색 미선택 ↔ 핑크 선택 —
// Figma 스크린샷 관측: 아이콘원 배경이 surface-strong↔primary-pale 로 바뀌는 것과 짝을
// 이뤄 아이콘 stroke 도 body(#3F3F3F)↔primary(#FF385C) 로 바뀐다). 정보 아이콘(ⓘ)만
// 상태가 없어 muted 고정.
type SelectableGlyphProps = GlyphProps & { selected?: boolean };

// 취향 카드 아이콘 컴포넌트 전부가 이 시그니처를 공유한다 — 화면에서 { Icon } 을 배열로
// 다루기 위한 공통 타입(개념: ComponentType<P> = "props P 를 받는 컴포넌트"의 타입).
export type GlyphComponent = ComponentType<SelectableGlyphProps>;

function selectableStroke(selected?: boolean): string {
  return selected ? '#FF385C' : '#3F3F3F';
}

// 스타일 — 휴양(sun).
export function SunGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 16.5C14.4853 16.5 16.5 14.4853 16.5 12C16.5 9.51472 14.4853 7.5 12 7.5C9.51472 7.5 7.5 9.51472 7.5 12C7.5 14.4853 9.51472 16.5 12 16.5Z"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 2.5V4.5M12 19.5V21.5M4.5 12H2.5M21.5 12H19.5M5.6 5.6L7 7M17 17L18.4 18.4M18.4 5.6L17 7M7 17L5.6 18.4"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// 스타일 — 미식(fork & knife).
export function ForkKnifeGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M7 2.5V10.5M9 2.5V10.5M5 2.5V8.5C5 9.6 5.9 10.5 7 10.5V21.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M17 2.5C15.3431 2.5 14 4.79086 14 7.5C14 9.98528 15.1193 12.0402 16.5714 12.4272L16 21.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 스타일 — 자연(mountain).
export function MountainGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M2.5 19.5L9 6.5L13.5 14.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12.5 19.5L16.5 10.5L21.5 19.5H12.5Z"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M2.5 19.5H21.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// 스타일 — 문화예술(사진/전시 프레임).
export function ArtGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M3.5 4.5H20.5V19.5H3.5V4.5Z"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3.5 15.5L8.5 10.5L12.5 14.5L16 11L20.5 15.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 8.5C8.55228 8.5 9 8.05228 9 7.5C9 6.94772 8.55228 6.5 8 6.5C7.44772 6.5 7 6.94772 7 7.5C7 8.05228 7.44772 8.5 8 8.5Z"
        stroke={stroke}
        strokeWidth={1.8}
      />
    </Svg>
  );
}

// 스타일 — 액티비티(pulse).
export function ActivityGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M2.5 12.5H7L9.5 5.5L13.5 19.5L16 12.5H21.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 스타일 — 관광(camera).
export function CameraGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M2.5 8.5C2.5 7.39543 3.39543 6.5 4.5 6.5H7.5L9 4.5H15L16.5 6.5H19.5C20.6046 6.5 21.5 7.39543 21.5 8.5V17.5C21.5 18.6046 20.6046 19.5 19.5 19.5H4.5C3.39543 19.5 2.5 18.6046 2.5 17.5V8.5Z"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 16C13.933 16 15.5 14.433 15.5 12.5C15.5 10.567 13.933 9 12 9C10.067 9 8.5 10.567 8.5 12.5C8.5 14.433 10.067 16 12 16Z"
        stroke={stroke}
        strokeWidth={1.8}
      />
    </Svg>
  );
}

// 스타일 — 쇼핑(bag).
export function ShoppingBagGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M4.5 8.5H19.5L18.5 20.5H5.5L4.5 8.5Z"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 8.5V6.5C8 4.29086 9.79086 2.5 12 2.5C14.2091 2.5 16 4.29086 16 6.5V8.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 페이스 — 느긋(moon).
export function MoonGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M20.5 13.6C19.4 14.1 18.2 14.4 16.9 14.4C12.4 14.4 8.8 10.8 8.8 6.3C8.8 5 9.1 3.8 9.6 2.7C5.7 3.6 2.8 7.1 2.8 11.2C2.8 16 6.7 19.9 11.5 19.9C15.6 19.9 19.1 17 20 13.1L20.5 13.6Z"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 페이스 — 균형(half dial).
export function BalanceGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 21.5C17.2467 21.5 21.5 17.2467 21.5 12C21.5 6.75329 17.2467 2.5 12 2.5C6.75329 2.5 2.5 6.75329 2.5 12C2.5 17.2467 6.75329 21.5 12 21.5Z"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M12 2.5V21.5" stroke={stroke} strokeWidth={1.8} />
      <Path
        d="M12 2.5C17.2467 2.5 21.5 6.75329 21.5 12C21.5 17.2467 17.2467 21.5 12 21.5V2.5Z"
        fill={stroke}
        fillOpacity={0.16}
      />
    </Svg>
  );
}

// 페이스 — 빡빡(lightning).
export function LightningGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M13 2.5L4.5 14H11L10.5 21.5L19.5 10H13L13 2.5Z"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 동행 — 혼자(person).
export function SoloPersonGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 12C14.2091 12 16 10.2091 16 8C16 5.79086 14.2091 4 12 4C9.79086 4 8 5.79086 8 8C8 10.2091 9.79086 12 12 12Z"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4.5 20C5.5 16.5 8.4 14.5 12 14.5C15.6 14.5 18.5 16.5 19.5 20"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 동행 — 친구(두 사람).
export function FriendsGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M9 11C10.6569 11 12 9.65685 12 8C12 6.34315 10.6569 5 9 5C7.34315 5 6 6.34315 6 8C6 9.65685 7.34315 11 9 11Z"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M2.5 19.5C3.3 16.3 5.9 14.5 9 14.5C12.1 14.5 14.7 16.3 15.5 19.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M15 5.2C16.4 5.6 17.4 6.9 17.4 8.4C17.4 9.9 16.4 11.2 15 11.6"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M16.5 14.8C19 15.3 21 17.1 21.7 19.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// 동행 — 연인(heart).
export function HeartGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 20.5C12 20.5 3 15.1 3 8.9C3 5.9 5.3 3.6 8.2 3.6C9.8 3.6 11.2 4.4 12 5.6C12.8 4.4 14.2 3.6 15.8 3.6C18.7 3.6 21 5.9 21 8.9C21 15.1 12 20.5 12 20.5Z"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 동행 — 가족(사람 여럿).
export function FamilyGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M7 10.5C8.38071 10.5 9.5 9.38071 9.5 8C9.5 6.61929 8.38071 5.5 7 5.5C5.61929 5.5 4.5 6.61929 4.5 8C4.5 9.38071 5.61929 10.5 7 10.5Z"
        stroke={stroke}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Path
        d="M17 10.5C18.3807 10.5 19.5 9.38071 19.5 8C19.5 6.61929 18.3807 5.5 17 5.5C15.6193 5.5 14.5 6.61929 14.5 8C14.5 9.38071 15.6193 10.5 17 10.5Z"
        stroke={stroke}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Path
        d="M12 13C13.3807 13 14.5 11.8807 14.5 10.5C14.5 9.11929 13.3807 8 12 8C10.6193 8 9.5 9.11929 9.5 10.5C9.5 11.8807 10.6193 13 12 13Z"
        stroke={stroke}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Path
        d="M2 19.5C2.5 16.9 4.4 15 7 15C8 15 8.9 15.3 9.6 15.8"
        stroke={stroke}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Path
        d="M22 19.5C21.5 16.9 19.6 15 17 15C16 15 15.1 15.3 14.4 15.8"
        stroke={stroke}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Path
        d="M6.5 20.5C7.2 18.1 9.4 16.5 12 16.5C14.6 16.5 16.8 18.1 17.5 20.5"
        stroke={stroke}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// 이동 — 도보 위주(발자국).
export function WalkGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M9 8.5C10.1046 8.5 11 7.60457 11 6.5C11 5.39543 10.1046 4.5 9 4.5C7.89543 4.5 7 5.39543 7 6.5C7 7.60457 7.89543 8.5 9 8.5Z"
        stroke={stroke}
        strokeWidth={1.7}
      />
      <Path
        d="M9.5 10L7 11L6.5 14.5L4.5 19.5"
        stroke={stroke}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9.5 10L11 13L10 15.5L11.5 19.5"
        stroke={stroke}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16 6.5C17.1046 6.5 18 5.60457 18 4.5C18 3.39543 17.1046 2.5 16 2.5C14.8954 2.5 14 3.39543 14 4.5C14 5.60457 14.8954 6.5 16 6.5Z"
        stroke={stroke}
        strokeWidth={1.7}
      />
      <Path
        d="M13.5 19.5L14.5 15L13.2 12L14.5 9.5L17.5 10L18.5 13.5L20 19.5"
        stroke={stroke}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 이동 — 대중교통(교환/순환 화살표).
export function TransitGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M4 9.5L4 15.5C4 16.6 4.9 17.5 6 17.5H16.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M14 14.5L17 17.5L14 20.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M20 14.5L20 8.5C20 7.4 19.1 6.5 18 6.5L7.5 6.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 3.5L7 6.5L10 9.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 이동 — 차량(car).
export function CarGlyph({
  size = 24,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = selectableStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M3.5 15.5V12L5.5 7.5C5.8 6.8 6.5 6.5 7.2 6.5H16.8C17.5 6.5 18.2 6.8 18.5 7.5L20.5 12V15.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3.5 12H20.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M3.5 15.5H20.5V18.5C20.5 19 20.1 19.5 19.5 19.5H18C17.5 19.5 17 19 17 18.5V17.5H7V18.5C7 19 6.5 19.5 6 19.5H4.5C4 19.5 3.5 19 3.5 18.5V15.5Z"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6.5 14.5H8.5M15.5 14.5H17.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// 취향 화면 상단 '나중에 설정하고 시작 >' 옆 chevron(c09/c09b) — ink 색, ViewChevronGlyph
// (muted-soft, 약관 "보기 ›" 전용)와 색이 달라 별도 글리프로 둔다.
export function SkipChevronGlyph({ size = 16, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Path
        d="M6 3.5L10.5 8L6 12.5"
        stroke="#222222"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// info 배너(ⓘ) — 상태 없음, muted 고정.
export function InfoCircleGlyph({ size = 16, testID }: GlyphProps) {
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
        stroke="#6A6A6A"
        strokeWidth={1.3}
      />
      <Path
        d="M8 7.2V11.3"
        stroke="#6A6A6A"
        strokeWidth={1.3}
        strokeLinecap="round"
      />
      <Path
        d="M8 5.4C8.44183 5.4 8.8 5.04183 8.8 4.6C8.8 4.15817 8.44183 3.8 8 3.8C7.55817 3.8 7.2 4.15817 7.2 4.6C7.2 5.04183 7.55817 5.4 8 5.4Z"
        fill="#6A6A6A"
      />
    </Svg>
  );
}
