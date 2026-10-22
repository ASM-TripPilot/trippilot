import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';

import type { TourPageSpec } from '../model/tourPages';

import { TourRoute, TourStopPin } from './TourGlyphs';

// 조각 래퍼 높이 — 어느 조각보다 크게 잡아 `justifyContent: 'center'` 가 조각을 offset 중심에 앉힌다(Yoga 는 자식이 더 크면 가운데로 안 모은다).
const FRAGMENT_BOX = 400;

/**
 * 한 장의 무대 — 점선 경로 + 정류장 핀 + 실화면 조각(children). 전부 장식이라 한 겹에서 눌림·읽기를 막는다(AC5):
 * `pointerEvents="none"`(터치 흡수 안 함) + 접근성 트리에서 숨김. 제목·본문은 이 밖에 있어 낭독에 남는다.
 *
 * 배치: 값이 무대 세로 중심(c) 기준이라, 높이 0 인 중심선 View 를 `top: '50%'` 에 놓고 그 안 absolute 자식의 `top` 을 c 대비 offset 으로 준다.
 * 조각은 자기 높이를 모르므로 충분히 큰 고정 높이 래퍼에 `justifyContent: 'center'` 로 넣어 중심이 offset 에 오게 한다.
 */
export function TourStage({
  spec,
  children,
}: {
  spec: TourPageSpec;
  children: ReactNode;
}): ReactElement {
  const { route, pin, fragment } = spec;
  return (
    <View
      testID={`onboarding-tour-stage-${spec.page}`}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="flex-1 overflow-hidden"
    >
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          height: 0,
        }}
      >
        <View style={{ position: 'absolute', left: 0, top: route.top }}>
          <TourRoute d={route.d} width={route.width} height={route.height} />
        </View>
        <View
          style={{
            position: 'absolute',
            left: pin.left,
            top: pin.centerY - 17,
          }}
        >
          <TourStopPin />
        </View>
        <View
          style={{
            position: 'absolute',
            left: fragment.left,
            top: fragment.centerY - FRAGMENT_BOX / 2,
            height: FRAGMENT_BOX,
            justifyContent: 'center',
          }}
        >
          {children}
        </View>
      </View>
    </View>
  );
}
