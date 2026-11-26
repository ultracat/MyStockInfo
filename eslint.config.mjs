// ESLint — 스타일이 아니라 **타입 검사가 못 잡는 비동기 실수**를 잡으려고 둔다(2026-11-16).
// safeStorage 비동기 전환 때 `await` 누락이 실제로 버그를 만들었다(routes/kisReports.ts의 accountId가 Promise로
// 응답됨 — backend/CLAUDE.md "secureStorage.ts" 항목). 그래서 규칙은 일부러 좁게:
//   - no-floating-promises: 결과를 안 쓰는 Promise 호출(저장이 끝나기 전에 넘어가거나 거부가 묻힘). 일부러 기다리지
//     않을 땐 `void`를 붙여 의도를 드러낸다.
//   - no-misused-promises(checksConditionals): `if (getX())`, `getX() ? …`처럼 Promise를 조건에 쓰는 것(항상 참).
//   - await-thenable: Promise가 아닌 것을 await.
// 스타일 규칙(따옴표·세미콜론 등)은 넣지 않는다 — 이 저장소는 포맷터 없이도 일관돼 있고, 소음만 늘린다.
// 실행: `npm run lint`(CI도 같은 명령, .github/workflows/ci.yml).
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // ⚠ 전역 제외는 `ignores`만 든 객체여야 한다(다른 키와 섞으면 그 설정에만 적용돼 dist까지 검사된다).
  { ignores: ['**/dist/**', '**/node_modules/**', 'release/**', 'backend/src/generated/**', 'egm-review/**'] },
  // scripts/*.cjs 등 규칙을 안 거는 파일의 옛 eslint-disable 주석까지 경고하지 않는다.
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  {
    files: ['backend/src/**/*.ts', 'electron/src/**/*.ts', 'frontend/src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      // 비동기 함수를 콜백으로 넘기는 것(express 핸들러·onClick)은 흔하고 의도된 것이라 void-return 검사는 끈다.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false, checksConditionals: true, checksSpreads: true }],
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  {
    // 화면(React) — 훅 호출 규칙은 오류, 의존성 배열은 경고(코드에 이유를 단 예외 주석이 이미 있다).
    files: ['frontend/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // `toISOString().slice(0, 10)`은 UTC 날짜라 한국 오전 9시 전엔 하루 전이 된다(오늘 날짜·파일 이름·조회 기간이 어제로 — 2026-11-26
      // 점검에서 여러 화면에서 발견). 화면 코드는 format.ts의 localToday()/formatLocalDate()만 쓴다.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name=/^(slice|substring|substr)$/][callee.object.type='CallExpression'][callee.object.callee.property.name='toISOString']",
          message: 'toISOString()은 UTC 날짜입니다 — 오늘은 format.ts의 localToday(), 다른 날짜는 formatLocalDate()를 쓰세요.',
        },
      ],
    },
  }
);
