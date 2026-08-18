// Google Sheets 연동에 쓰는 OAuth 2.0 클라이언트(Google Cloud Console에서 발급,
// 애플리케이션 유형: "데스크톱 앱")의 Client ID/Secret.
//
// 사용법: 이 파일을 같은 폴더에 `clientConfig.ts`로 복사한 뒤 실제 값을 채운다.
// `clientConfig.ts`는 .gitignore에 등록되어 커밋되지 않고, 앱 빌드(dist)에만
// 컴파일되어 들어간다 — 일반 사용자는 이 값을 입력하거나 알 필요가 없다(앱에
// 미리 박아서 배포). 하나의 Client ID/Secret을 이 앱을 빌드하는 모든 사용자가
// 공유한다 — 각 사용자는 자기 Google 계정으로 로그인만 하면 된다.
export const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
export const GOOGLE_CLIENT_SECRET = 'YOUR_GOOGLE_CLIENT_SECRET';
