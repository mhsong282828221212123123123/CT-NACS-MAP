# CT-NACS-MAP

환경부(한국환경공단) 전기자동차 충전소 정보 Open API에서 **NACS(`chgerType` `09` NACS / `10` DC콤보+NACS)** 충전기만 필터링하여 내 GPS 위치 기준으로 보여주는 웹앱입니다.

- **실제 배포 주소 (GitHub Pages)**: https://mhsong282828221212123123123.github.io/CT-NACS-MAP/
- **저장소**: https://github.com/mhsong282828221212123123123/CT-NACS-MAP

### 주요 기능
- **GPS 거리순 정렬**: 현재 위치 기준 가까운 NACS 충전소를 거리순으로 확인
- **NACS 전용 필터**: `NACS 전용(09)`, `DC콤보+NACS(10)`, `충전대기만`, `무료주차`, `외부인 개방`
- **상세 현황 & 길안내**: 충전기별 상태·출력(kW)·층수 정보 및 네이버지도 / 카카오맵 / 티맵 원터치 길안내
- **이중 워크플로 자동 갱신**:
  - `sync-master.yml` — 하루 1회(03:00 KST) `getChargerInfo`로 전국 NACS 마스터 데이터 수집 (~45호출/일)
  - `sync-status.yml` — 5분마다 `getChargerStatus?period=10`으로 최근 변경분만 패치해 커밋 없이 배포 (~300~600호출/일)
  - `deploy.yml` — 코드 푸시 시 자동 빌드·배포

---

## 1. 네이버 클라우드 플랫폼 (Maps) 설정

[네이버 클라우드 플랫폼 콘솔 → Maps → Application](https://console.ncloud.com/maps/application)에서 Application을 등록할 때 아래 설정을 적용합니다.

- **API 선택**: `Dynamic Map` 체크
- **Web 서비스 URL**:
  - `https://mhsong282828221212123123123.github.io`
  - `http://localhost:5173` (로컬 개발용)

> 반드시 구형 `AI NAVER API`가 아닌 신규 **Maps** 상품에서 발급받은 **Client ID**를 사용해야 합니다.

---

## 2. GitHub Secrets 등록 (자동 데이터 갱신 및 배포)

[레포지토리 Settings → Secrets and variables → Actions → Repository secrets](https://github.com/mhsong282828221212123123123/CT-NACS-MAP/settings/secrets/actions)에 아래 두 값을 등록합니다.

| 이름 | 설명 |
|---|---|
| `NAVER_MAP_CLIENT_ID` | 네이버 클라우드 플랫폼 Maps **Client ID** |
| `DATA_GO_KR_API_KEY` | 공공데이터포털 `한국환경공단_전기자동차 충전소 정보` **일반 인증키 (Decoding)** |
| `GA_MEASUREMENT_ID` | Google Analytics 4 측정 ID (예: `G-XXXXXXXXXX`, 선택) |

등록 후 **Actions → Deploy NACS Map to GitHub Pages → Run workflow**를 실행하면 전국 NACS 실데이터가 반영된 사이트가 배포됩니다. (이후 매 3시간마다 자동 갱신)

---

## 3. 로컬 실행

```bash
cp .env.example .env.local
# .env.local에 VITE_NAVER_MAP_CLIENT_ID와 DATA_GO_KR_API_KEY 입력

npm install
npm run fetch:nacs   # 환경부 API에서 NACS(09/10)만 추출 -> public/data/nacs.json
npm run dev          # http://localhost:5173/CT-NACS-MAP/
```
