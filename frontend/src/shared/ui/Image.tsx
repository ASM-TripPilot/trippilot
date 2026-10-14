import { Image } from 'expo-image';
import { cssInterop } from 'nativewind';

// expo-image 는 NativeWind 가 className 을 style 로 바꿔 주는 대상이 아니다 — 여기서 한 번 등록하고,
// 사용처는 expo-image 를 직접 import 하지 않고 이 모듈의 Image 를 쓴다(등록 누락 방지).
cssInterop(Image, { className: 'style' });

export { Image };
