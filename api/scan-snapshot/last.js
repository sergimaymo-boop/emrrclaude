/**
 * MOVED — Logic consolidated into /api/scan-snapshot.js
 * This file intentionally has no export default so Vercel does not deploy it
 * as a separate Serverless Function (Hobby plan: 12-function limit).
 * Requests to /api/scan-snapshot/last are rewritten to /api/scan-snapshot?action=last
 * via vercel.json rewrites.
 */
