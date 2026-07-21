# End-to-end test environment

Playwright owns the local Next.js development-server lifecycle by default.

- `PLAYWRIGHT_PORT` optionally selects the local port; it defaults to `3100` and must be between `1024` and `65535`.
- `PLAYWRIGHT_BASE_URL` targets an already-running local, preview, or deployed HTTP(S) server. When set, Playwright does not start or stop a server.
- `CI` enables two retries, one worker, the GitHub reporter, and forbids committed focused tests.

Test credentials and seeded actor IDs will use dedicated `E2E_*` variables when authentication is implemented. They must remain outside Git and must never reuse production credentials.
