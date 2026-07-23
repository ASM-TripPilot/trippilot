import { render, screen } from '@testing-library/react-native';

import { LocationPreprompt } from './LocationPreprompt';

/**
 * c08-location 전체화면 전환(1296:1208 / 1297:1208) 구조 가드 (Seed 확정 1·5, TRIP-162).
 *
 * 문구 일반 규칙(Seed 확정 1)의 두 갈래를 이 파일이 고정한다:
 *  - testID 만 단언돼 온 지점(allow·later 버튼) → **Figma 문구 채택** ("위치 사용 허용"/"나중에 하기")
 *  - 동결 테스트가 문구를 단언하는 지점(거부 안내 '설정에서') → **기존 문구 유지**
 *
 * 전체화면 레이아웃 자체(카드 → 풀스크린)와 denied 버튼 라벨은 [검증] 스크린샷 대조 몫.
 * 기존 testID 전량 보존(AC-INV1)·콜백 계약은 동결 테스트(LocationPreprompt.test.tsx)가 커버한다.
 */

const PURPOSE = '내 주변 숙소를 찾으려면 현재 위치가 필요해요';

function renderDefault() {
  render(
    <LocationPreprompt
      purposeContext={PURPOSE}
      onProceed={jest.fn()}
      onDefer={jest.fn()}
    />
  );
}

describe('LocationPreprompt — Figma 문구 채택 지점 (default)', () => {
  it('허용 버튼은 "위치 사용 허용", 보류 버튼은 "나중에 하기" 라벨을 쓴다', () => {
    renderDefault();

    expect(screen.getByTestId('onboarding-location-allow')).toHaveTextContent(
      '위치 사용 허용'
    );
    expect(screen.getByTestId('onboarding-location-later')).toHaveTextContent(
      '나중에 하기'
    );
  });
});

describe('LocationPreprompt — 히어로 일러스트 (default)', () => {
  it('레이더 히어로 일러스트 요소가 렌더된다', () => {
    renderDefault();

    // 전체화면 전환의 구조 증거 — 일러스트의 생김새(중첩 ellipse)는 스크린샷이 검증한다.
    expect(screen.getByTestId('onboarding-location-hero')).toBeOnTheScreen();
  });
});

describe('LocationPreprompt — 기존 문구 유지 지점 (denied)', () => {
  it('전체화면 전환 후에도 거부 안내에 "설정에서" 조각이 남아 있다', () => {
    render(
      <LocationPreprompt
        purposeContext={PURPOSE}
        state="permission-denied"
        onProceed={jest.fn()}
        onDefer={jest.fn()}
        onOpenSettings={jest.fn()}
      />
    );

    // 동결 테스트와 같은 앵커를 새 파일에서도 고정한다 — 전면 재작성 중 문구 회귀 방지.
    expect(
      screen.getByTestId('onboarding-location-denied-notice')
    ).toHaveTextContent('설정에서');
  });
});
