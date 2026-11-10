'use strict';

// Docker HEALTHCHECK probe. Uses Node itself, so the image needs no curl/wget.
const port = process.env.PORT || 3000;
fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) })
  .then((res) => process.exit(res.ok ? 0 : 1))
  .catch(() => process.exit(1));
