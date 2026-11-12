import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { BottomTabBar, type ShellTabKey } from '@/shared/ui/BottomTabBar';
import { BarExitHost, useBarExit } from '@/widgets/bottom-nav-bar/index.exit';

// expo-router 라우트 이름 → 탭바 key. index 라우트만 이름이 다르다(파일 규약상 홈은 index).
function routeNameToTabKey(name: string): ShellTabKey {
  if (name === 'index') return 'home';
  return name as ShellTabKey;
}

// 진짜 탭 바 + 하단 바 퇴장 호스트(TRIP-1831). 뒤로를 누른 허브·기록 화면은 그 순간 스택에서 빠지고 바의 퇴장 모프를 이 호스트가 이어 재생한다 —
// 모프가 도는 동안 진짜 탭 바는 거의 투명(`ghost`)하게 아래 서 있다가 끝나면 그대로 이어받는다. 구독은 렌더프롭 안이 아니라 자식 컴포넌트가 한다.
function TabBarWithExit({
  activeKey,
  onPressTab,
}: {
  activeKey: ShellTabKey;
  onPressTab: (key: ShellTabKey) => void;
}) {
  const exit = useBarExit();
  return (
    <>
      <BottomTabBar
        activeKey={activeKey}
        onPressTab={onPressTab}
        ghost={exit !== null}
      />
      <BarExitHost />
    </>
  );
}

// tabBar 렌더프롭(Q4 전면 커스텀) — 네비게이션 상태를 읽어 BottomTabBar에 순수 props로
// 넘기는 어댑터. BottomTabBar 자신은 이 매핑을 몰라야 하므로 경계를 이 파일에 둔다.
function renderTabBar(props: BottomTabBarProps) {
  const activeRoute = props.state.routes[props.state.index];
  const activeKey = routeNameToTabKey(activeRoute.name);

  // 화면이 `navigation.setOptions({ tabBarStyle: { display: 'none' } })` 로 숨김을 요청하면 안 그린다(TRIP-1240 —
  // 씬 안의 바텀시트가 이 absolute 오버레이 뒤로 들어가 아래쪽이 가려졌다). 커스텀 `tabBar` 는 react-navigation 이
  // `display` 를 대신 적용해 주지 않아 여기서 직접 읽는다. 스타일이 배열일 수 있어 flatten 으로 펼친다.
  const requested = props.descriptors[activeRoute.key]?.options.tabBarStyle;
  if (StyleSheet.flatten(requested as StyleProp<ViewStyle>)?.display === 'none')
    return null;

  function handlePressTab(key: ShellTabKey) {
    const targetRouteName = key === 'home' ? 'index' : key;
    props.navigation.navigate(targetRouteName);
  }

  return <TabBarWithExit activeKey={activeKey} onPressTab={handlePressTab} />;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // TRIP-1731 — 안 보이는 탭은 얼린다(react-native-screens `Freeze`): 다른 탭에 있는 동안 홈 쿼리가 갱신돼도
        // 다시 그리지 않고, 돌아올 때 최신 값으로 한 번 그린다. 쿼리 구독은 그대로라 재조회 요청 수는 안 바뀐다.
        // 탭 밖에서 반응해야 하는 감시(생성·푸시·계정 경계)는 탭 위 SplashGate 에 있어 안 얼는다.
        freezeOnBlur: true,
        // AC-O2(동결 계약)가 이 옵션의 존재를 요구한다. 단 react-navigation 은 커스텀 `tabBar`
        // 렌더프롭을 쓸 때 `tabBarStyle` 을 적용하지 않으므로 이 값은 **무효**다(BottomTabView.js
        // 실측 — position 분기 없음). 실제 오버레이는 `BottomTabBar` 루트의 `absolute bottom-0`
        // 가 진다(씬을 탭바 높이만큼 줄이지 않음). 마지막 항목 비가림은 각 화면의 하단 여백(A7).
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
        },
      }}
      tabBar={renderTabBar}
    >
      <Tabs.Screen name="index" options={{ title: '홈' }} />
      <Tabs.Screen name="explore" options={{ title: '탐색' }} />
      <Tabs.Screen name="itinerary" options={{ title: '일정' }} />
      <Tabs.Screen name="records" options={{ title: '기록' }} />
      <Tabs.Screen name="my" options={{ title: '마이' }} />
    </Tabs>
  );
}
