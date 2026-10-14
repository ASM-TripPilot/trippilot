# assets/fonts — 네이티브 임베드 폰트 (TRIP-1361)

`app.config.ts` 의 `expo-font` config plugin 이 이 4개를 네이티브 번들에 넣는다(iOS `Info.plist` `UIAppFonts` · Android `assets/fonts`).
JS 에서 `useFonts` 로 로드하지 않는다 → 첫 렌더부터 폰트가 있고 "폰트 전 빈 화면" 게이트가 없다. **바꾸면 네이티브 재빌드가 필요하다(OTA 불가).**

| 파일 | 내용 | 크기 |
|---|---|---|
| `Inter_700Bold.ttf` | `@expo-google-fonts/inter` 700Bold 원본(이름표만 교체) | 344KB |
| `NotoSansKR_{400Regular,500Medium,700Bold}.ttf` | Noto Sans KR 서브셋 2,524자(원본 6.19MB/굵기) | 각 약 503KB |

합계 약 1.8MB. `expo export` 의 JS 에셋에는 폰트가 0개다(네이티브로만 간다).

## 폰트명 계약 (조용히 깨진다)

`tailwind.config.js` `fontFamily` 토큰(`Inter_700Bold` · `NotoSansKR_400Regular` …) = **파일명** = 폰트 **내부 이름**(name 테이블 ID 1·4·6)이 글자 단위로 같아야 한다.
iOS 는 내부(PostScript) 이름으로, Android 는 파일명으로 찾기 때문이다. 원본 구글 폰트의 내부 이름은 `NotoSansKR-Regular`·`Inter-Bold` 처럼 달라서
그대로 넣으면 **iOS 에서 조용히 시스템 폰트로 떨어진다**(에러 없음). 그래서 `rename_font.py` 로 이름표를 토큰 이름으로 바꿨다.
`src/__tests__/releaseBuildConfig.test.ts` 가 토큰 = 파일명 = 내부 PostScript 이름을 잠근다.

## 재현 (서브셋 + 이름표 교체)

도구는 1회성이다 — 리포 의존성이 아니다: `python3 -m venv venv && venv/bin/pip install fonttools`.

```sh
# 1) 글자 목록 = ASCII 0x20~0x7E + KS X 1001 한글 2,350자 + src 의 비ASCII 문자(테스트·mocks 제외)
#    extract_chars.py <src경로> 가 src 쪽을 뽑는다. glyphs.txt 가 2026-10-13 시점의 결과(2,524자).
python3 extract_chars.py ../../src            # 한글이 glyphs.txt 에 없으면 목록에 추가해 다시 서브셋

# 2) 서브셋 (원본: node_modules/@expo-google-fonts/noto-sans-kr/<굵기>/NotoSansKR_<굵기>.ttf)
pyftsubset NotoSansKR_700Bold.ttf --text-file=glyphs.txt --layout-features='*' --no-hinting \
  --output-file=NotoSansKR_700Bold.subset.ttf

# 3) 이름표를 파일명(=tailwind 토큰)으로 교체 → assets/fonts/ 에 저장
python3 rename_font.py NotoSansKR_700Bold.subset.ttf NotoSansKR_700Bold.ttf NotoSansKR_700Bold
python3 rename_font.py <Inter_700Bold 원본>.ttf Inter_700Bold.ttf Inter_700Bold   # Inter 는 서브셋 없이 이름만
```

한글 2,350자는 EUC-KR(KS X 1001) 완성형을 `bytes([hi, lo]).decode('euc-kr')` 로 0xB0A1~0xC8FE 범위를 훑어 만든다(`glyphs.txt` 에 이미 들어 있다).

## 시험 결과 (2026-10-13)

- src 전수(테스트 제외)의 비ASCII 문자 집합 1,029종은 한글 포함 전부 `glyphs.txt` 에 있다(누락 0).
- 서브셋에 일부러 뺀 글자(옫 숮 샾 뎜 · 家愛酒味 韓國 · ＆ ㈜ ♡ Ⅱ)도 iOS 시뮬레이터에서 □ 없이 시스템 폰트로 그려졌다.
- 실데이터 장소 이름 11,166곳 127,801자 중 KS X 1001 밖은 73자(0.06%) — 시스템 폰트 폴백으로 그려진다.
- 서브셋에 없는 글자는 □ 가 아니라 OS 폴백 폰트로 그려진다(네이티브 폰트 폴백). 그래도 새 화면에 희귀 글자를 박으면 `extract_chars.py` 로 목록을 갱신한다.
