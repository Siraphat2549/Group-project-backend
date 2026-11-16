// FR-17–26 · date validation (FR-19) · no double booking (FR-20) · NFR-2.
describe('Bookings (integration)', () => {
  describe('create', () => {
    it.todo(
      'IT-BK-01 POST /bookings -> 201, status PENDING, stores user, room, check-in/out date-time',
    );
    it.todo('IT-BK-02 check-out equal to or before check-in -> 400');
    it.todo('IT-BK-03 check-in in the past -> 400');
    it.todo('IT-BK-04 missing or malformed date-times -> 400');
    it.todo('IT-BK-05 unknown room -> 404; deactivated room -> 400/404');
    it.todo('IT-BK-06 no token -> 401');
  });

  describe('double booking (FR-20)', () => {
    it.todo('IT-BK-10 overlapping range on the same room -> 409');
    it.todo(
      'IT-BK-11 range inside / enclosing / identical to an existing booking -> 409',
    );
    it.todo(
      'IT-BK-12 back-to-back (new check-in == existing check-out) -> 201',
    );
    it.todo('IT-BK-13 same range on a different room -> 201');
    it.todo('IT-BK-14 range of a CANCELLED booking is free again -> 201');
    it.todo(
      'IT-BK-15 two concurrent requests for the same room/range -> exactly one 201, one 409; one row in DB',
    );
  });

  describe('ownership & admin', () => {
    it.todo('IT-BK-20 GET /bookings returns only the caller’s bookings');
    it.todo('IT-BK-21 GET /bookings/:id of own booking -> 200');
    it.todo('IT-BK-22 GET /bookings/:id of another user’s booking -> 403');
    it.todo('IT-BK-23 unknown booking id -> 404');
    it.todo('IT-BK-24 user cancels own booking -> 200, status CANCELLED');
    it.todo('IT-BK-25 user cancels another user’s booking -> 403');
    it.todo('IT-BK-26 Admin lists all bookings of all users -> 200');
    it.todo('IT-BK-27 Admin sets APPROVED, then PAID -> 200; DB updated');
    it.todo('IT-BK-28 Admin cancels a booking -> 200, CANCELLED');
    it.todo('IT-BK-29 invalid status value or transition -> 400/409');
    it.todo('IT-BK-30 Regular user tries to set APPROVED/PAID -> 403');
  });
});
