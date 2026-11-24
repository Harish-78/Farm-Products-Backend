// Vercel serverless catch-all entrypoint — handles /api/*.
// The full request path is preserved, so Express mounts (/api/auth, /api/farm, ...)
// keep working exactly as in local development.
export { default } from '../src/index.js';
