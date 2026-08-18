// 한국수출입은행 Open API(exchangeJSON) 인증키 — 무료 발급, 계좌/거래 권한이
// 전혀 없는 공개 일별 환율 조회 전용 키다(eximbankClient.ts 참고).
//
// 사용법: 이 파일을 같은 폴더에 `eximbankConfig.ts`로 복사한 뒤 실제 값을 채운다.
// `eximbankConfig.ts`는 .gitignore에 등록되어 커밋되지 않고, 앱 빌드(dist)에만
// 컴파일되어 들어간다 — 일반 사용자는 이 값을 입력하거나 알 필요가 없다.
export const EXIMBANK_AUTH_KEY = 'YOUR_EXIMBANK_AUTH_KEY';
