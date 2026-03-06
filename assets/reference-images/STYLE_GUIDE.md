# 이미지 생성 스타일 레퍼런스

## 폴더 구조
```
assets/reference-images/
├── hero/     ← 히어로 배너 이미지 레퍼런스
├── icon/     ← 3D 아이콘/일러스트 레퍼런스
├── 2d/       ← 2D/flat 스타일 이미지 레퍼런스
└── STYLE_GUIDE.md
```

## 동작
- `generate_image` 호출 시 prompt 키워드로 카테고리 자동 매칭
- 매칭된 폴더에서 랜덤 2장 선택 → Gemini API에 스타일 참조로 전달
- 파일명 자유, 지원 포맷: png / jpg / webp

## 키워드 매칭
| 폴더 | 매칭 키워드 |
|------|-----------|
| `hero/` | banner, hero, 배너, 히어로, carousel, background, cover |
| `icon/` | icon, logo, 아이콘, 로고, symbol, badge, coin, gift, object |
| `2d/` | style="2d" 또는 style="tossface" 지정 시 강제 사용 |
| (기본) | 매칭 없으면 `icon/` 사용 |
