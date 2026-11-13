# onchain

공개 온체인 원시 데이터로 비트코인 지표를 직접 계산하고, 계산 원리와 함께 GitHub Pages에 게재하는 저장소입니다. GitHub Actions가 매일 데이터를 받아 지표를 다시 계산하고 페이지를 갱신합니다.

- 페이지: https://tlzkrh1029.github.io/onchain/
- AASI: https://tlzkrh1029.github.io/onchain/aasi/

## 지표

| 지표 | 설명 | 데이터 |
|---|---|---|
| [AASI](https://tlzkrh1029.github.io/onchain/aasi/) | 활성 주소 수와 가격의 28일 변화율을 비교해 단기 과열과 과매도를 판단합니다. Look Into Bitcoin의 AASI를 재현했습니다. | Coin Metrics `AdrActCnt`, `PriceUSD` |

## 구조

```
build.py                    데이터 수집 → 지표 계산 → data/ 와 _site/ 생성
indicators/aasi.py          AASI 계산식
site/                       정적 페이지 원본 (HTML, CSS, JS, uPlot)
site/assets/nav.js          왼쪽 지표 목록과 메인 페이지 카드의 목록 (지표 추가 시 여기에 한 줄 추가)
data/coinmetrics_btc.csv    Coin Metrics 원자료 스냅샷 (매일 자동 커밋)
data/aasi.csv               AASI 계산 결과 (매일 자동 커밋)
.github/workflows/pages.yml 매일 07:41 UTC(16:41 KST) 빌드·배포
```

## 일간 갱신 방식

1. `.github/workflows/pages.yml`이 매일 07:41 UTC에 실행됩니다. Actions 탭에서 `Run workflow`로 직접 실행할 수도 있습니다.
2. `build.py`가 Coin Metrics Community API에서 데이터를 받아 지표를 계산합니다. API에 접속하지 못하면 `data/`에 저장된 직전 데이터로 페이지를 만들고, 페이지에 그 사실을 표시합니다.
3. 바뀐 데이터는 `data/`에 커밋됩니다. 이 커밋은 공개 저장소의 예약 실행이 60일 동안 활동이 없을 때 자동으로 꺼지는 것도 막아 줍니다.
4. `_site/`가 GitHub Pages로 배포됩니다.

처음 한 번은 저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정해야 합니다.

## 지표 추가 방법

1. `indicators/`에 계산 모듈을 만들고, `build.py`에서 결과를 `_site/data/<지표>.json`으로 쓰게 합니다.
2. `site/<지표>/index.html` 페이지를 만듭니다. `site/aasi/index.html`의 상단 막대, 왼쪽 목록, 본문 구조를 그대로 쓰면 됩니다.
3. `site/assets/nav.js`의 `NAV`에 항목을 추가합니다. 왼쪽 목록과 메인 페이지 카드에 함께 나타납니다. 같은 지표를 여러 분류에 넣을 때는 `{ ref: "<경로>/" }`로 적습니다.

## 차트 조작

- BTC 가격(오른쪽 로그 눈금)과 28일 변화율·밴드(왼쪽 눈금)를 한 차트에 함께 그립니다.
- 끌기: 차트 안을 좌우로 끌어 구간을 고르고, 손을 떼면 확대합니다. 더블클릭의 두 번째 클릭을 누른 채로 끌어도 같습니다.
- 더블클릭: 선택한 기간과 전체 기간을 번갈아 표시합니다.
- 확대한 상태에서 더블클릭: 확대 전 화면으로 돌아갑니다.

## 로컬에서 실행

```bash
pip install -r requirements.txt
python build.py            # API에서 받아 빌드
python build.py --offline  # data/coinmetrics_btc.csv만 사용
python -m http.server -d _site 8000   # http://localhost:8000
```

## 데이터와 라이선스

- 데이터: [Coin Metrics](https://coinmetrics.io/) Community Data, [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). 비상업적 이용과 출처 표기가 조건입니다.
- 차트: [uPlot](https://github.com/leeoniya/uPlot) (MIT).
- 원 지표: [Look Into Bitcoin AASI](https://www.lookintobitcoin.com/charts/active-address-sentiment-indicator/). 이 저장소는 원 지표의 데이터를 싣지 않고, 공개 데이터로 같은 계산식을 재현합니다.

이 저장소의 내용은 정보 제공을 위한 것이며 투자 조언이 아닙니다.
