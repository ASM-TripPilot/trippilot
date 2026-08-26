import { render, screen } from '@testing-library/react-native';

import { LiveLocationPage } from './LiveLocationPage';

/**
 * TRIP-442 · AC-2·AC-3·AC-4 — i20(수동 입력)·i21(권한 거부) 얼굴 상태.
 *
 * 무엇을 보장하나(초심자용): **한 컴포넌트**를 `state` prop 하나로 두 얼굴로 그린다.
 *  - i20 `state='manual'`: "위치를 확인할 수 없어…" 배너 + 건너뛰기 어포던스.
 *  - i21 `state='permission-denied'`: "위치 권한이 꺼져 있어…" 배너 + **등록 숙소 기준(추정)** 프리시드.
 *  - 두 얼굴 공통: "이 위치로 계속"·건너뛰기·지도(origin 수집 UI) → i21 은 막다른 화면이 아니다.
 *
 * 3동작: 준비(state prop 으로 render) → 실행(렌더가 곧 실행) → 단언(얼굴 testID·문구).
 *
 * ★ 문구 단언은 **정규식 부분일치**다 — 문자열 matcher 는 완전 일치라(RNTL 13.3.3 `matches.js` 실측)
 *   아이콘+텍스트 한 노드에서 깨진다. 특징 구절만 잠근다.
 * ★ 지도 롱프레스→핀 좌표는 가짜 SDK Proxy 라 jest 원리적 사각(AC-6). 여기서는 지도 **마운트**
 *   (`map-root`)만 확인하고 상호작용·"(추정)" i20 선택값은 6-b 실기 몫(02a ★사각 A·B·D).
 * ★ 구현 전에는 `./LiveLocationPage` 모듈이 없어 이 suite 는 모듈 미해석 red 다(placeDetailStubRoute 관례).
 */

// `@/shared/map` 을 좌표 마커 목으로 치환 — 실 KakaoMapView 는 JS 키가 없으면 map-failure 로
// 떨어지고(WebView 는 jest 렌더 트리에 아무것도 안 남김), 목은 center 를 Text 로 노출한다.
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

describe('LiveLocationPage — i20 수동 입력 얼굴 (state=manual)', () => {
  it('manual 얼굴을 그리고 permission-denied 루트는 없다(상호배타)', () => {
    // 준비·실행
    render(<LiveLocationPage tripId="trip-1" state="manual" />);

    // 단언 — state 로 얼굴이 갈린다(파라미터화의 기계 증거).
    expect(screen.getByTestId('live-location-manual')).toBeOnTheScreen();
    expect(screen.queryByTestId('live-location-permission-denied')).toBeNull();
  });

  it('i20 배너·공통 subline·중립 건너뛰기 문구·CTA·지도를 그린다', () => {
    render(<LiveLocationPage tripId="trip-1" state="manual" />);

    // i20 안내 배너(권한이 아니라 "위치를 확인할 수 없어").
    expect(screen.getByText(/위치를 확인할 수 없어/)).toBeOnTheScreen();
    // 공통 subline — 입력값이 추정 출발지로 쓰인다.
    expect(screen.getByText(/추정 출발지로 사용돼요/)).toBeOnTheScreen();
    // 건너뛰기 어포던스 + 중립 가정 문구(클라가 사다리 재판정 안 함, 서버 위임).
    expect(
      screen.getByTestId('live-location-use-last-visit')
    ).toBeOnTheScreen();
    expect(
      screen.getByText(/마지막 방문지나 등록 숙소 기준/)
    ).toBeOnTheScreen();
    // 주 CTA(존재만 — 누름→MANUAL 좌표 핸드오프는 지도 사각, 6-b).
    expect(screen.getByText(/이 위치로 계속/)).toBeOnTheScreen();
    // 지도 마운트(상호작용 아님 — 렌더만).
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
  });
});

describe('LiveLocationPage — i21 권한 거부 얼굴 (state=permission-denied)', () => {
  it('permission-denied 얼굴을 그리고 manual 루트는 없다(상호배타)', () => {
    render(<LiveLocationPage tripId="trip-1" state="permission-denied" />);

    expect(
      screen.getByTestId('live-location-permission-denied')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('live-location-manual')).toBeNull();
  });

  it('권한 거부 배너 + 등록 숙소 기준(추정) 프리시드 + 안내 힌트를 그린다', () => {
    render(<LiveLocationPage tripId="trip-1" state="permission-denied" />);

    // i21 만 다른 배너 카피(권한 꺼짐).
    expect(screen.getByText(/위치 권한이 꺼져 있어/)).toBeOnTheScreen();
    // STAY_ANCHOR 프리시드 선택값 + "(추정)" — AC-3 로컬 도출의 컴포넌트 증거.
    expect(screen.getByText(/등록 숙소 기준\s*\(추정\)/)).toBeOnTheScreen();
    // 프리시드 안내 힌트.
    expect(screen.getByText(/등록 숙소를 기준으로 잡았어요/)).toBeOnTheScreen();
  });

  it('막다른 화면이 아니다 — 수동 입력 유도 어포던스(지도·CTA·건너뛰기)가 있다', () => {
    render(<LiveLocationPage tripId="trip-1" state="permission-denied" />);

    // AC-2 — i21 은 안내로 끝나지 않고 2순위(수동 입력)로 잇는다. 공유 어포던스가 그 증거.
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
    expect(screen.getByText(/이 위치로 계속/)).toBeOnTheScreen();
    expect(
      screen.getByTestId('live-location-use-last-visit')
    ).toBeOnTheScreen();
  });
});
