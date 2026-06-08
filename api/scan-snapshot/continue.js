/**
 * MOVED — Logic consolidated into /api/scan-snapshot.js
 * This file intentionally has no export default so Vercel does not deploy it
 * as a separate Serverless Function (Hobby plan: 12-function limit).
 * Requests to /api/scan-snapshot/continue are rewritten to /api/scan-snapshot?action=continue
 * via vercel.json rewrites.
 */
