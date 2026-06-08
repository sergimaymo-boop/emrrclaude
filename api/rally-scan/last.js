/**
 * MOVED — Logic consolidated into /api/rally-scan.js
 * This file intentionally has no export default so Vercel does not deploy it
 * as a separate Serverless Function (Hobby plan: 12-function limit).
 * Requests to /api/rally-scan/last are rewritten to /api/rally-scan?action=last
 * via vercel.json rewrites.
 */
