// FR-30–31 notifications · rate limiting · FR-36 health with real deps.
describe('Notifications, rate limiting, health (integration)', () => {
  it.todo(
    'IT-NOTIF-01 creating a booking records a "booking created" event for that user',
  );
  it.todo(
    'IT-NOTIF-02 cancelling a booking (by user or Admin) records a "booking cancelled" event',
  );
  it.todo(
    'IT-NOTIF-03 notifications API returns only the caller’s events; no token -> 401',
  );
  it.todo('IT-RL-01 /auth/login over the limit within the window -> 429');
  it.todo('IT-RL-02 POST /bookings over the limit -> 429');
  it.todo(
    'IT-HLTH-01 GET /health with test MySQL + Redis up -> 200, every check "up"',
  );
});
