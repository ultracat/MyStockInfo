import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGoogleClientInput } from '../src/google/clientCredentials';

test('Google OAuth 클라이언트 입력 형식 검사', () => {
  assert.equal(validateGoogleClientInput('123456789012-abcdef123.apps.googleusercontent.com', 'GOCSPX-abcdefghij_KL'), null);
  assert.match(validateGoogleClientInput('not-a-client-id', 'GOCSPX-abcdefghij')!, /Client ID/);
  assert.match(validateGoogleClientInput('123-abc.apps.googleusercontent.com', 'bad secret!')!, /Client Secret/);
});
