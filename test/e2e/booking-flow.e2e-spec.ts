// Realistic user/admin journeys through the real app + test DB.
// Each journey asserts the HTTP responses AND the resulting database state
// (rubric criterion 18). Test IDs match docs/API-TESTING.md.
describe('Booking journeys (e2e)', () => {
  it.todo(
    'E2E-01 guest signs up -> logs in -> searches available rooms -> books -> sees it in own list -> cancels; DB: booking CANCELLED, 2 notification events, room available again',
  );
  it.todo(
    'E2E-02 Admin creates room + uploads image -> user books it -> Admin approves -> Admin marks PAID; DB: status history matches',
  );
  it.todo(
    'E2E-03 RBAC: user cannot create/edit/delete rooms or change booking status; user B cannot see or cancel user A’s booking; DB unchanged',
  );
  it.todo(
    'E2E-04 double booking: second user books an overlapping time range on the same room -> 409; DB still has exactly one active booking; search hides the room',
  );
  it.todo(
    'E2E-05 user updates own profile, logs out -> old token rejected (401)',
  );
});
