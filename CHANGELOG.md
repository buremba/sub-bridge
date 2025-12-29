# Changelog

## [1.0.0](https://github.com/buremba/sub-bridge/compare/sub-bridge-v1.2.1...sub-bridge-v1.0.0) (2025-12-29)


### Features

* add custom URL provider for users with their own public IP/domain ([ccc5719](https://github.com/buremba/sub-bridge/commit/ccc57191df3ddfaf567a257e50ecae12f4a63dbe))
* bootstrap release automation ([a1c1f57](https://github.com/buremba/sub-bridge/commit/a1c1f5734d660152edf60b0227a8951d9e0ede11))
* simplify tunnels to Cloudflare only with named tunnel support ([2a57bc4](https://github.com/buremba/sub-bridge/commit/2a57bc4ee1013dcf38bfd364b03ca93571e07dc4))


### Bug Fixes

* add delay for DNS propagation before quick tunnel health check ([e76f082](https://github.com/buremba/sub-bridge/commit/e76f082bd55c716a133516c51023d9c228e81e50))
* add OIDC debug logging to npm publish workflow ([29bec36](https://github.com/buremba/sub-bridge/commit/29bec369a961c4ae67a5800087a5bcc1bb7954f9))
* add registry-url to setup-node for npm auth ([387c8d9](https://github.com/buremba/sub-bridge/commit/387c8d92c7cbccdc76f5f9e329c243809e9ce20d))
* add repository url for npm provenance ([db7425e](https://github.com/buremba/sub-bridge/commit/db7425e59f8413bdc5b5020691d3369cecd3d82a))
* configure npm trusted publishing (OIDC) ([02ef8dd](https://github.com/buremba/sub-bridge/commit/02ef8ddc4ee94e4b69f8fcfe3c85324213d23f0c))
* detect embedded browser and prompt to open in external browser ([5a4e5f2](https://github.com/buremba/sub-bridge/commit/5a4e5f2588184518fc3f5bdbb79d280ee0208e1e))
* improve Cloudflare tunnel reliability ([a200e9c](https://github.com/buremba/sub-bridge/commit/a200e9ccc917f7946ca9a6da2f8d7e2601e0b1f0))
* improve error handling and add model alias support ([b38884a](https://github.com/buremba/sub-bridge/commit/b38884ae1424c9b91e330ed9a463779e3e259508))
* manually exchange OIDC token for npm token ([b1f9564](https://github.com/buremba/sub-bridge/commit/b1f9564cdd0fc79a4511e2b1f51be61c818271ba))
* prevent global cloudflared config from interfering with quick tunnels ([6bbda0b](https://github.com/buremba/sub-bridge/commit/6bbda0b7a2e2cdf381d1375b265cbb8a18d4935d))
* remove NODE_AUTH_TOKEN unset for npm OIDC ([6d64f6d](https://github.com/buremba/sub-bridge/commit/6d64f6df0c5b74cc0ebd1363498babf98b420832))
* set NPM_CONFIG_PROVENANCE for OIDC ([230d881](https://github.com/buremba/sub-bridge/commit/230d8815ecda3b069cd561d9693fa0fcb14e245f))
* simplify cloudflare tunnel startup to only wait for URL event ([b47fcea](https://github.com/buremba/sub-bridge/commit/b47fcea9296f0c01c498568102316ea47e6b84e1))
* simplify npm publish command ([4edc1a2](https://github.com/buremba/sub-bridge/commit/4edc1a2b39ef8af96cf01d07bb8f4fa7b8d7d4eb))
* surface cloudflare tunnel errors (rate limiting, etc.) to user ([86211b9](https://github.com/buremba/sub-bridge/commit/86211b9afadc4c5c9073324ec01486031e8f9006))
* use NPM_TOKEN for npm authentication ([dd570b3](https://github.com/buremba/sub-bridge/commit/dd570b3ada072c84ff890f4ce13a220d8bdc5f20))
* use NPM_TOKEN secret for npm auth ([95d3c27](https://github.com/buremba/sub-bridge/commit/95d3c27020bbafac5223420f035f7f2b1df4994e))
* wait for cloudflare tunnel connection after URL is received ([fb62e5e](https://github.com/buremba/sub-bridge/commit/fb62e5e5725e5a0206c97ccb8d3558a13055061e))

## [1.2.1](https://github.com/buremba/sub-bridge/compare/sub-bridge-v1.2.0...sub-bridge-v1.2.1) (2025-12-26)


### Bug Fixes

* detect tunnel process exit and update status in UI
* fix ChatGPT codex API "Instructions are not valid" error
* add Claude token refresh endpoint for automatic token renewal
* return refreshToken and email from auth complete endpoint
* validate Claude tokens on page load and show expired status


## [1.2.0](https://github.com/buremba/sub-bridge/compare/sub-bridge-v1.1.2...sub-bridge-v1.2.0) (2025-12-25)


### Features

* add custom URL provider for users with their own public IP/domain ([ccc5719](https://github.com/buremba/sub-bridge/commit/ccc57191df3ddfaf567a257e50ecae12f4a63dbe))

## [1.1.2](https://github.com/buremba/sub-bridge/compare/sub-bridge-v1.1.1...sub-bridge-v1.1.2) (2025-12-25)


### Bug Fixes

* add delay for DNS propagation before quick tunnel health check ([e76f082](https://github.com/buremba/sub-bridge/commit/e76f082bd55c716a133516c51023d9c228e81e50))

## [1.1.1](https://github.com/buremba/sub-bridge/compare/sub-bridge-v1.1.0...sub-bridge-v1.1.1) (2025-12-25)


### Bug Fixes

* prevent global cloudflared config from interfering with quick tunnels ([6bbda0b](https://github.com/buremba/sub-bridge/commit/6bbda0b7a2e2cdf381d1375b265cbb8a18d4935d))

## [1.1.0](https://github.com/buremba/sub-bridge/compare/sub-bridge-v1.0.2...sub-bridge-v1.1.0) (2025-12-24)


### Features

* simplify tunnels to Cloudflare only with named tunnel support ([2a57bc4](https://github.com/buremba/sub-bridge/commit/2a57bc4ee1013dcf38bfd364b03ca93571e07dc4))


### Bug Fixes

* add OIDC debug logging to npm publish workflow ([29bec36](https://github.com/buremba/sub-bridge/commit/29bec369a961c4ae67a5800087a5bcc1bb7954f9))
* add registry-url to setup-node for npm auth ([387c8d9](https://github.com/buremba/sub-bridge/commit/387c8d92c7cbccdc76f5f9e329c243809e9ce20d))
* add repository url for npm provenance ([db7425e](https://github.com/buremba/sub-bridge/commit/db7425e59f8413bdc5b5020691d3369cecd3d82a))
* manually exchange OIDC token for npm token ([b1f9564](https://github.com/buremba/sub-bridge/commit/b1f9564cdd0fc79a4511e2b1f51be61c818271ba))
* set NPM_CONFIG_PROVENANCE for OIDC ([230d881](https://github.com/buremba/sub-bridge/commit/230d8815ecda3b069cd561d9693fa0fcb14e245f))
* simplify cloudflare tunnel startup to only wait for URL event ([b47fcea](https://github.com/buremba/sub-bridge/commit/b47fcea9296f0c01c498568102316ea47e6b84e1))
* simplify npm publish command ([4edc1a2](https://github.com/buremba/sub-bridge/commit/4edc1a2b39ef8af96cf01d07bb8f4fa7b8d7d4eb))
* surface cloudflare tunnel errors (rate limiting, etc.) to user ([86211b9](https://github.com/buremba/sub-bridge/commit/86211b9afadc4c5c9073324ec01486031e8f9006))
* use NPM_TOKEN secret for npm auth ([95d3c27](https://github.com/buremba/sub-bridge/commit/95d3c27020bbafac5223420f035f7f2b1df4994e))
* wait for cloudflare tunnel connection after URL is received ([fb62e5e](https://github.com/buremba/sub-bridge/commit/fb62e5e5725e5a0206c97ccb8d3558a13055061e))

## [1.0.2](https://github.com/buremba/sub-bridge/compare/sub-bridge-v1.0.1...sub-bridge-v1.0.2) (2025-12-23)


### Bug Fixes

* configure npm trusted publishing (OIDC) ([02ef8dd](https://github.com/buremba/sub-bridge/commit/02ef8ddc4ee94e4b69f8fcfe3c85324213d23f0c))
* remove NODE_AUTH_TOKEN unset for npm OIDC ([6d64f6d](https://github.com/buremba/sub-bridge/commit/6d64f6df0c5b74cc0ebd1363498babf98b420832))
* use NPM_TOKEN for npm authentication ([dd570b3](https://github.com/buremba/sub-bridge/commit/dd570b3ada072c84ff890f4ce13a220d8bdc5f20))

## [1.0.1](https://github.com/buremba/sub-bridge/compare/sub-bridge-v1.0.0...sub-bridge-v1.0.1) (2025-12-23)


### Bug Fixes

* improve Cloudflare tunnel reliability ([a200e9c](https://github.com/buremba/sub-bridge/commit/a200e9ccc917f7946ca9a6da2f8d7e2601e0b1f0))

## 1.0.0 (2025-12-23)


### Features

* bootstrap release automation ([a1c1f57](https://github.com/buremba/sub-bridge/commit/a1c1f5734d660152edf60b0227a8951d9e0ede11))
