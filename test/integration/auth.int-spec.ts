// FR-1–5 · NFR-1, NFR-4. Test IDs match docs/API-TESTING.md.
describe('Auth & Users (integration)', () => {
  it.todo(
    'IT-AUTH-01 POST /auth/register (name, email, password) -> 201; DB stores a hash, never the plaintext password',
  );
  it.todo('IT-AUTH-02 register with an existing email -> 409');
  it.todo(
    'IT-AUTH-03 register with missing name / invalid email / short password -> 400 with a clear message',
  );
  it.todo('IT-AUTH-04 POST /auth/login valid credentials -> 200 with JWT');
  it.todo(
    'IT-AUTH-05 login with wrong password or unknown email -> 401, same message for both',
  );
  it.todo('IT-AUTH-06 no auth/profile response contains password or hash');
  it.todo(
    'IT-AUTH-07 GET own profile without token -> 401; with token -> 200 own data only',
  );
  it.todo(
    'IT-AUTH-08 update own profile -> 200 and change persisted; invalid data -> 400',
  );
  it.todo('IT-AUTH-09 log out -> the same token is rejected (401)');
  it.todo('IT-AUTH-10 expired or tampered JWT -> 401');
  it.todo(
    'IT-SEC-01 passwords and tokens never appear in application logs during register/login',
  );
});
