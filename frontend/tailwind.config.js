/** @type {import('tailwindcss').Config} */
// theme.extend 는 Figma TripPilot 변수 컬렉션(파일 1MTF3dtptIrbg8gld5IdO2)의 미러다.
// Figma 변수를 바꾸면 여기와 src/__tests__/design-tokens.test.ts 를 함께 갱신한다.
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#FF385C',
        'primary-active': '#E00B41',
        'primary-pale': '#FFE4E9',
        'primary-text': '#C13515',
        'on-primary': '#FFFFFF',
        canvas: '#FFFFFF',
        'canvas-alt': '#FAFAFA',
        'surface-soft': '#F7F7F7',
        'surface-strong': '#F2F2F2',
        hairline: '#EDEDED',
        'hairline-strong': '#DDDDDD',
        ink: '#222222',
        body: '#3F3F3F',
        muted: '#6A6A6A',
        'muted-soft': '#9AA1AB',
        link: '#1659C9',
        info: '#0B6E63',
        'info-bg': '#F0FCFA',
        'info-border': '#A1E8DD',
        success: '#0E9384',
        'success-bg': '#E4F5F1',
        'presence-blue': '#1B6EF3',
        'presence-blue-bg': '#E7F0FB',
        'presence-teal': '#14B8A6',
        scrim: '#000000', // 사용처에서 40% opacity (bg-scrim/40)
      },
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
      // fontFamily 는 Figma 변수 컬렉션이 아니라 D2 폰트 번들(@expo-google-fonts)의 코드측
      // 매핑이다. 값은 useFonts 가 등록하는 폰트명과 정확히 일치해야 한다. (design-tokens.test 동기화 대상)
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
