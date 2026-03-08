# AI 이미지 생성 (Gemini API)

디자인에 일러스트, 배너 그래픽, 아이콘 이미지 등이 필요한 경우 **반드시 Gemini API (나노바나나프로 모델)** 를 사용한다.

## 파이프라인
```
Gemini API (나노바나나프로) → 로컬 저장 (assets/generated/) → rembg 배경 제거 → HTTP 서버 (localhost:18765) → Figma set_image_fill
```

## 사용법
- **API Key**: Settings UI에서 설정 (앱 헤더 기어 아이콘 → Gemini API Key 입력)
- **모델**: `nano-banana-pro-preview` ← 반드시 이 모델 사용 (실제 작동 확인)
- **API Header**: `X-goog-api-key` 헤더로 키 전달 (Authorization Bearer 방식 아님)
- **저장 경로**: `assets/generated/` 디렉토리에 PNG로 저장
- **배경 제거**: rembg Python 라이브러리 사용 (`python3 -c "from rembg import remove; ..."`)
- **HTTP 서버**: `python3 -m http.server 18765` 로 로컬 서빙 → Figma가 localhost URL로 이미지 다운로드
- **Figma 적용**: `set_image_fill(nodeId, url: "http://localhost:18765/assets/generated/xxx.png", scaleMode: "FILL")`

## 그래픽 스타일 기본값 (소프트 매트 3D)
- **기본 렌더링**: `Cinema4D, Octane render, soft diffused studio lighting, front view, orthographic view`
- **기본 뷰**: 사용자가 view에 대한 다른 요구사항이 없으면 항상 **front view** 적용
- **기본 질감 = 소프트 매트 (NOT glossy)** — 광택 없는 부드러운 매트/클레이 질감이 기본. glossy/shiny는 명시적 요청 시에만 사용
- **3D 그래픽 스타일 핵심 특징** (Gemini 프롬프트에 반영):
  - **질감**: soft matte material with very subtle sheen, like matte clay or soft rubber — 광택 반사(specular highlight) 최소화, 매끄럽지만 반사 없는 표면
  - **오브젝트**: 단순하고 상징적인 형태, 서비스 컨셉과 직결되는 명확한 객체 (동전, 지갑, 로켓 등)
  - **배경**: 투명 또는 단색 (solid white), 디스트랙션 최소화
  - **색감**: 파스텔 톤 기반, 밝고 산뜻한 톤, 따뜻하고 친근한 느낌. 강한 명암 대비 금지
  - **조명**: 매우 부드럽고 고른 디퓨즈드 조명 (diffused studio lighting), 강한 그림자 없음, subtle pastel-tinted rim light만 허용
  - **분위기**: 차갑고 딱딱한 느낌을 따뜻하고 친근하게 전환, 토이 같은 느낌
- **Gemini 프롬프트 필수 키워드**: `"Soft matte material with very subtle sheen, NOT glossy, NOT shiny. Like matte clay or soft rubber texture. Soft diffused studio lighting, NO harsh shadows, NO strong contrast. Cinema4D Octane render, soft even illumination, matte finish. Single centered object, pure white background, no ground shadow."`
- 모든 Gemini 이미지 프롬프트에 위 스타일 키워드를 기본으로 포함할 것
- 사용자가 별도 스타일을 지정한 경우에만 기본 스타일 대신 해당 스타일 적용

## 규칙 (자동 적용 필수)
- 디자인 작업 중 일러스트, 배너 그래픽, 히어로 이미지, 썸네일 등 커스텀 그래픽이 필요한 상황이 오면 **사용자가 별도로 요청하지 않아도 자동으로 이 파이프라인을 실행**한다
- 텍스트/아이콘으로 대체하거나 placeholder rectangle을 남기는 것 금지
- 프롬프트는 영어로 작성, 배경 투명 필요 시 rembg 실행, 필요 없으면 raw 이미지 바로 사용
- rembg는 `rembg` CLI 명령어가 없을 수 있으므로 Python API로 직접 호출할 것:
  ```python
  from rembg import remove
  output = remove(open("input.png","rb").read())
  open("output.png","wb").write(output)
  ```
