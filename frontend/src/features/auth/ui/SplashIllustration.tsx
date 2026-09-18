import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// 스플래시 상단 비행경로 일러스트(c01 IO). 점선 곡선 + 종이비행기 마커 + 목적지 핀 2개는
// 하나의 장식 조합이라 이 존 박스 안에서만 절대좌표 오버레이를 유지한다(SKILL 4단계 예외 —
// 장식은 absolute 허용). 좌표·색은 Figma 에셋(path-curve·airplane-marker·pin-small/large.svg)
// 을 그대로 옮긴 raw 값이다.

function FlightPathCurve() {
  return (
    <Svg
      width={390}
      height={300}
      viewBox="0 0 390 300"
      fill="none"
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      <Path
        d="M55 230C138.333 103.333 230 81.6668 330 165"
        stroke="#FF385C"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeDasharray="2 9"
      />
    </Svg>
  );
}

function AirplaneMarker() {
  return (
    <Svg width={34} height={34} viewBox="0 0 34 34" fill="none">
      <Path d="M30 4L4 15L15 19L19 30L30 4Z" fill="#FF385C" />
      <Path d="M30 4L15 19L19 30L30 4Z" fill="#FF8298" />
    </Svg>
  );
}

function PinSmall() {
  return (
    <Svg width={22} height={28} viewBox="0 0 22 28" fill="none">
      <Path
        d="M11 0.777832C5.4 0.777832 0.888885 5.05561 0.888885 10.5001C0.888885 17.1112 11 27.2223 11 27.2223C11 27.2223 21.1111 17.1112 21.1111 10.5001C21.1111 5.05561 16.6 0.777832 11 0.777832Z"
        fill="#FF385C"
        stroke="#ffffff"
        strokeWidth={1.86667}
      />
      <Path
        d="M11 13.7667C12.8041 13.7667 14.2667 12.3042 14.2667 10.5001C14.2667 8.69593 12.8041 7.2334 11 7.2334C9.19587 7.2334 7.73334 8.69593 7.73334 10.5001C7.73334 12.3042 9.19587 13.7667 11 13.7667Z"
        fill="#ffffff"
      />
    </Svg>
  );
}

function PinLarge() {
  return (
    <Svg width={27} height={34} viewBox="0 0 27 34" fill="none">
      <Path
        d="M13.5 0.944336C6.70001 0.944336 1.22223 6.13878 1.22223 12.7499C1.22223 20.7777 13.5 33.0554 13.5 33.0554C13.5 33.0554 25.7778 20.7777 25.7778 12.7499C25.7778 6.13878 20.3 0.944336 13.5 0.944336Z"
        fill="#FF385C"
        stroke="#ffffff"
        strokeWidth={2.26667}
      />
      <Path
        d="M13.5 16.9053C15.7951 16.9053 17.6556 15.0448 17.6556 12.7498C17.6556 10.4547 15.7951 8.59424 13.5 8.59424C11.205 8.59424 9.34445 10.4547 9.34445 12.7498C9.34445 15.0448 11.205 16.9053 13.5 16.9053Z"
        fill="#ffffff"
      />
    </Svg>
  );
}

export function SplashIllustration() {
  return (
    <View testID="shell-splash-illustration" className="h-[300px] w-full">
      <FlightPathCurve />
      <View className="absolute left-[40px] top-[216px]">
        <AirplaneMarker />
      </View>
      <View className="absolute left-[175px] top-[92px]">
        <PinSmall />
      </View>
      <View className="absolute left-[316px] top-[132px]">
        <PinLarge />
      </View>
    </View>
  );
}
