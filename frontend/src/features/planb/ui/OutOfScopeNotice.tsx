import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

/**
 * TRIP-439 · AC-4 · BR-U4-14 — 서버가 "이 여행에서 바꿀 수 없는 요청"으로 판정했을 때 시트 안에
 * 뜨는 인라인 안내(전체화면 교체 아님).
 *
 * 이 컴포넌트는 **표시만** 한다 — 콜백 prop 이 없고 누를 수 있는 요소도 없다. 클라는 자유 텍스트를
 * 재해석·재판정하지 않는다(BR-U4-13 · INV-1). 내용 판정은 전부 서버 몫이다.
 *
 * 도시명(부산 등)은 여행별 값이라 문구에 박지 않는다(브리프 관측: 서버/여행 종속).
 * 색은 Figma 실측 토큰 — bg `primary-pale` · 텍스트 `primary-text`.
 */

const OUT_OF_SCOPE_TITLE = '이 여행에서 바꿀 수 있는 요청이 아니에요';
const OUT_OF_SCOPE_BODY =
  '여행지·날짜는 여기서 못 바꿔요. 오늘 일정 안에서 바꿀 것만 적어 주세요';

export function OutOfScopeNotice(): ReactElement {
  return (
    <View
      testID="planb-request-out-of-scope"
      className="gap-[6px] rounded-input bg-primary-pale px-[14px] py-[12px]"
    >
      <Text className="font-noto-bold text-caption font-bold text-primary-text">
        {OUT_OF_SCOPE_TITLE}
      </Text>
      <Text className="font-noto text-micro text-primary-text">
        {OUT_OF_SCOPE_BODY}
      </Text>
    </View>
  );
}
