import { useState, type ReactElement, type ReactNode } from 'react';
import { Text } from 'react-native';
import { screen } from '@testing-library/react-native';

import { useBarExit } from '@/widgets/bottom-nav-bar/index.exit';

/**
 * TRIP-1831 · 하단 바의 "이동과 동시에 퇴장" 을 jest 로 재는 공용 도우미.
 *
 * 실제 앱에서는 뒤로를 누르는 순간 그 화면(과 안의 바)이 스택에서 빠지고, 바의 퇴장 모프는 탭 레이아웃의 호스트(`BarExitHost`)가 이어 간다.
 * 테스트의 `onBack` 은 목이라 화면이 안 빠지므로, `LeavingScreen` 이 "onBack 이 불리면 그 화면을 걷는다" 를 대신한다.
 *  - `screen(leave)` — 화면(바가 든 트리)을 그린다. 바의 `onBack` 에 `leave(목 함수)` 를 꽂으면, 누르는 순간 목이 불리고 같은 이벤트 안에서 화면이 걷힌다.
 *  - `children` — 화면 옆에 항상 서 있는 것(호스트·진짜 탭 바·`ExitProbe`).
 */
export function LeavingScreen({
  screen: renderScreen,
  children,
}: {
  screen: (leave: (onBack: () => void) => () => void) => ReactElement;
  children?: ReactNode;
}): ReactElement {
  const [present, setPresent] = useState(true);
  const leave = (onBack: () => void) => () => {
    onBack();
    setPresent(false);
  };
  return (
    <>
      {present ? renderScreen(leave) : null}
      {children}
    </>
  );
}

/** 퇴장 저장소의 지금 값을 글자로 보인다 — 비었으면 `none`, 있으면 그 번호(`id`). 호스트 없이 "퇴장이 시작됐나·몇 번 시작됐나"만 볼 때 쓴다. */
export function ExitProbe(): ReactElement {
  const exit = useBarExit();
  return <Text testID="bar-exit-probe">{exit ? String(exit.id) : 'none'}</Text>;
}

/** `ExitProbe` 가 지금 보이는 글자(`none` 또는 번호). */
export const exitProbeText = (): string =>
  String(screen.getByTestId('bar-exit-probe').props.children);
