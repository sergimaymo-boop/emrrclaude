# Future Auth & Access Plan

## Current State

Current access is personal use only.

The current login is `DEV ONLY MOCK AUTH`. It is not real security and must not
be used to sell access or invite third parties.

No provider is installed:

- no Supabase,
- no Clerk,
- no Auth.js,
- no database,
- no payments,
- no user management.

## Future Goal

When access for another person or future clients is needed, implement a real
authentication phase with:

- individual users,
- individual passwords,
- activation/deactivation controlled by the owner,
- owner/admin role,
- user role,
- protected app access,
- password reset/change,
- provider-side password hashing,
- no secrets exposed in frontend,
- audit-friendly access control.

## Preferred Future Options

Evaluate only when explicitly authorized:

- Supabase Auth,
- Clerk,
- Auth.js with a compatible database/provider.

Decision criteria:

- simple owner-controlled user activation,
- low cost for early personal/client usage,
- Vercel compatibility,
- secure password handling,
- future role support.

## Future Environment Variables

Placeholders already reserved in `.env.example`:

```text
AUTH_SECRET
AUTH_PROVIDER
APP_PASSWORD
SUPABASE_URL
SUPABASE_ANON_KEY
```

Future API keys such as `EODHD_API_KEY` and `FINNHUB_API_KEY` must remain
server-side only.

## Implementation Rules

- Do not implement real auth before explicit approval.
- Do not store real passwords in code.
- Do not expose secrets in frontend.
- Do not add user databases before a provider is chosen.
- Do not add payments until commercial access is explicitly approved.
- Keep mock auth removable behind a small auth boundary.

## Suggested Future Phase

Implement real auth in a dedicated phase after the financial workflow is
validated, preferably Phase 8 or Phase 9.

Recommended first real version:

1. Owner/admin account.
2. Invite/create user.
3. Activate/deactivate user.
4. Protected dashboard.
5. Password reset/change through provider.

