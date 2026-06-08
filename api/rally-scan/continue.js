/**
 * MOVED — Logic consolidated into /api/rally-scan.js
 * This file intentionally has no export default so Vercel does not deploy it
 * as a separate Serverless Function (Hobby plan: 12-function limit).
 * Requests to /api/rally-scan/continue are rewritten to /api/rally-scan?action=continue
 * via vercel.json rewrites.
 */
