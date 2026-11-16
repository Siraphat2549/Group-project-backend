// FR-8–16 · NFR-3 · caching. Test IDs match docs/API-TESTING.md.
describe('Rooms (integration)', () => {
  it.todo(
    'IT-ROOM-01 Admin POST /rooms (name, capacity, price per night) -> 201 + success message; row in DB',
  );
  it.todo(
    'IT-ROOM-02 Regular user create/edit/delete room -> 403; no token -> 401',
  );
  it.todo(
    'IT-ROOM-03 invalid payload (capacity < 1, negative price, missing name) -> 400',
  );
  it.todo('IT-ROOM-04 GET /rooms and GET /rooms/:id work for guests -> 200');
  it.todo('IT-ROOM-05 unknown room id -> 404 with a clear message');
  it.todo(
    'IT-ROOM-06 Admin edits a room -> 200; GET shows the new values (cache invalidated)',
  );
  it.todo(
    'IT-ROOM-07 Admin deletes/deactivates a room -> hidden from public list and search, cannot be booked',
  );
  it.todo(
    'IT-ROOM-08 Admin uploads an image -> 201; metadata stored; GET /rooms/:id returns the image',
  );
  it.todo('IT-ROOM-09 upload a non-image / oversized file -> 400');
});
