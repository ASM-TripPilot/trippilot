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
