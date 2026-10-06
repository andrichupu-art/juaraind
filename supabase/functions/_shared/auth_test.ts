import { hasAdminRole } from './auth.ts';

Deno.test('admin role requires an explicit trusted app-metadata claim', () => {
  const cases: Array<[unknown, boolean]> = [
    [{ role: 'admin' }, true],
    [{ user_role: 'admin' }, true],
    [{ is_admin: true }, true],
    [{ role: 'user' }, false],
    [{ is_admin: 'true' }, false],
    [{}, false],
    [null, false],
    ['admin', false],
  ];

  for (const [metadata, expected] of cases) {
    if (hasAdminRole(metadata) !== expected) {
      throw new Error(`Unexpected admin-role result for ${JSON.stringify(metadata)}`);
    }
  }
});
