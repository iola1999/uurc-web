# UU Remote Web

[中文](README.zh-CN.md)

[![CI](https://github.com/iola1999/uurc-web/actions/workflows/ci.yml/badge.svg)](https://github.com/iola1999/uurc-web/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A self-hosted web controller for UU Remote. Connect to and control your UU Remote devices from a browser.

## Public instance

Try the public instance at [https://uurc.678234.xyz](https://uurc.678234.xyz).

It is useful for reviewing the interface and basic flow. UU Remote Web handles SMS login, account credentials, and authenticated UU API requests. Self-hosting is recommended for regular use. Enter SMS codes, sign in, or import credentials only on instances you control or fully trust.

A Cloudflare Worker plus Durable Object is the easiest self-hosted option. The Worker serves the application, forwards UU API requests, and runs the signal gateway. Remote video, audio, and input are still negotiated by the browser over WebRTC. Automatic routing can use LAN or P2P direct connectivity and fall back to UU relay when required. Deploying on Cloudflare does not disable direct connections.

The public landing page is prerendered during the frontend build so its content is present in the initial HTML. Login, device, account, and remote-control routes continue to use the client-side application shell and are excluded from search indexing.

## Features

- SMS login
- Login-state import and export
- Device list
- Remote video, audio, input, and clipboard synchronization
- Multi-display selection, connection diagnostics, and recovery
- Partner assistance and takeover control
- Account management
- Node and Cloudflare gateways for UU API and signal traffic

## Self-hosting

### Cloudflare (recommended)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/iola1999/uurc-web)

The Cloudflare deployment uses a Worker and Durable Object without Cloudflare Containers. Use the button above for a quick deployment, or deploy from a local checkout:

```bash
npm ci
npx wrangler login
npm run deploy:cloudflare
```

See the [Cloudflare deployment guide](cloudflare/README.md) for requirements, trust boundaries, and direct-connection details.

### Docker

Use `http://localhost:8787` on the Docker host. Access from another computer or phone requires HTTPS with a trusted certificate: browser request signing and clipboard access depend on a secure context. A LAN IP or plain HTTP domain will fail these checks.

For example, run [Caddy](https://caddyserver.com/docs/automatic-https) on the same host, point a domain at it, and allow ports 80/443:

```caddyfile
remote.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

Configure access authentication separately before exposing the service publicly.

```bash
docker run -d \
  --name uurc-web \
  -p 8787:8787 \
  iola1999/uurc-web:latest
```

Or:

```bash
curl -O https://raw.githubusercontent.com/iola1999/uurc-web/main/compose.yml
docker compose up -d
```

Each page instance gets an independent signal capability. Refreshing creates a new session; partner assistance returns to verification with the device ID filled in. Gateways authorize only the token and targets returned by a successful UU room join for that session. Browser inactivity for two minutes closes the signal connection and removes temporary authorization and events. Public deployments still need Cloudflare Access, an authenticated reverse proxy, or another access gateway.

Wisp is disabled by default because the frontend currently uses the local proxy transport. Set `ENABLE_WISP=true` only when testing the optional WASM curl transport.

## Security

Login state is stored in the current browser, while UU API requests pass through the deployment in use. A shared-instance operator can technically observe the requests it proxies. Prefer self-hosting, and remove SMS codes, credentials, tokens, device IDs, room data, and network addresses from public logs and screenshots.

Read [SECURITY.md](SECURITY.md) for the full trust model and private reporting process.

The remote toolbar includes a text input dialog for mobile keyboards and local IME composition. Text is sent when you select Send, preserving spaces and line breaks.

## Development

```bash
npm ci
npm run dev
```

```bash
npm test
npm run build
docker build -t iola1999/uurc-web:local .
```

## Contributing

- [Contributing guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)
- [Project audit, 2026-09-05 (Chinese)](docs/project-audit-2026-09-05.zh-CN.md)
- [Audit fixes and validation (Chinese)](implementation-notes.md)

## Acknowledgements

The Cloudflare deployment architecture references [AssppWeb](https://github.com/Lakr233/AssppWeb), especially its Cloudflare deployment ergonomics and local-gateway relay mindset.

## License

[MIT](LICENSE)
