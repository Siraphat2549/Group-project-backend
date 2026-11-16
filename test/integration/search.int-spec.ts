// FR-27–29: search returns only rooms truly available for the range.
describe('Search & availability (integration)', () => {
  it.todo(
    'IT-SRCH-01 date range -> only rooms with no overlapping active booking',
  );
  it.todo(
    'IT-SRCH-02 capacity filter -> only rooms with capacity >= requested',
  );
  it.todo('IT-SRCH-03 date range + capacity combined');
  it.todo('IT-SRCH-04 deactivated rooms are never returned');
  it.todo('IT-SRCH-05 rooms whose only bookings are CANCELLED are returned');
  it.todo('IT-SRCH-06 back-to-back with an existing booking is returned');
  it.todo('IT-SRCH-07 missing / reversed / invalid range -> 400');
});
