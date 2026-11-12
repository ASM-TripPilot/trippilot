/** @type {import('tailwindcss').Config} */
// 색은 src/shared/config/colorTokens.cjs 가 정본이다(Figma TripPilot 변수 컬렉션 미러, TRIP-1774) — 색을 바꾸면 거기만 고친다.
module.exports = {
  // 라우트(루트 app/)도 넣는다 — 빠지면 라우트에서만 쓰는 클래스의 스타일이 조용히 안 생긴다(TRIP-1161 실측 11개).
  content: ['./src/**/*.{js,jsx,ts,tsx}', './app/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: require('./src/shared/config/colorTokens.cjs'),
      borderRadius: {
        card: '16px',
        'sheet-top': '24px',
        button: '12px',
        input: '12px',
        thumb: '12px',
        pill: '999px',
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
        '3xl': '32px',
      },
      // lineHeight 는 Figma % 의 px 반올림 파생값 (RN 은 unitless 미지원)
      fontSize: {
        display: ['26px', { lineHeight: '34px' }],
        hero: ['22px', { lineHeight: '29px' }],
        section: ['17px', { lineHeight: '23px' }],
        'card-title': ['15px', { lineHeight: '20px' }],
        body: ['14px', { lineHeight: '20px' }],
        label: ['13px', { lineHeight: '18px' }],
        caption: ['12px', { lineHeight: '16px' }],
        micro: ['11px', { lineHeight: '14px' }],
      },
      // fontFamily 는 Figma 변수 컬렉션이 아니라 assets/fonts 임베드 폰트의 코드측 매핑이다. 값은
      // app.config.ts expo-font 플러그인에 넣은 파일명(=폰트 내부 이름)과 정확히 일치해야 한다.
      // (releaseBuildConfig.test 가 잠근다)
      fontFamily: {
        'inter-bold': ['Inter_700Bold'],
        noto: ['NotoSansKR_400Regular'],
        'noto-medium': ['NotoSansKR_500Medium'],
        'noto-bold': ['NotoSansKR_700Bold'],
      },
    },
  },
  plugins: [],
};
