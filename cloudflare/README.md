# Cloudflare Deploy

[中文](README.zh-CN.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/iola1999/uurc-web)

This deployment mode uses a Cloudflare Worker plus a Durable Object. It does not depend on Cloudflare Containers.

The project provides a public instance at [https://uurc.678234.xyz](https://uurc.678234.xyz) for quick evaluation. Create your own Worker before signing in, importing credentials, or using the application regularly.

## What Runs On Cloudflare

- Static frontend from `frontend/dist`, with a prerendered public landing page and a noindex client app shell
- `/api/proxy/uu` UU API forwarding
- `/api/health`
- Durable Object-backed `/api/remote/signal/*` status, event, diagnostics, and error-reporting endpoints

The live signal gateway is implemented in the Worker Durable Object. It uses an upstream Engine.IO/Socket.IO WebSocket opened with Worker `fetch(..., Upgrade: websocket)`.

## Connection routing and direct paths

Cloudflare sits on the application, UU API, and signaling paths. The browser establishes remote media and input channels through WebRTC:

1. The browser sends UU API requests through the Worker and receives room configuration.
2. The Durable Object connects to the upstream Socket.IO signal service and exchanges control messages, SDP, and ICE candidates.
3. The browser selects a LAN, P2P, or UU relay path from the ICE result.

The default automatic mode allows LAN and P2P direct connectivity. It can fall back to UU relay when the network requires it. The advanced "Force UU relay" option selects a relay path explicitly. The Worker does not carry WebRTC media. Note that the UU server decides routing from the source IP of the signaling socket: the Durable Object egresses from Cloudflare datacenter addresses, and current UU policy forces relay for datacenter sources, so Cloudflare deployments alone no longer reach direct paths. Installing the companion [extension](../extension/README.md) lets the browser open the signaling socket itself; routing is then decided from the browser's own network and direct connectivity is preserved.

## Security

Account state stays in the browser, while authenticated UU API requests still pass through your Worker. Self-hosting keeps that proxy path under your Cloudflare account.

Random session capabilities isolate the Durable Object signal state used by different browser tabs. They do not authenticate access to the deployment. Add Cloudflare Access or another access layer to public deployments, and allow the application's required `/api/*` requests in that policy.

Do not enter SMS codes or import credentials into an instance you do not trust. See [SECURITY.md](../SECURITY.md) for the complete trust model.

## Requirements

- Cloudflare Workers account with Durable Objects enabled.
- Deploy/build token with `Workers Scripts Edit`.

## Deploy

Use the Deploy button at the top of this page, or deploy from a local checkout:

```bash
npm ci
npx wrangler login
npm run deploy:cloudflare
```

For local Cloudflare runtime preview:

```bash
npm run dev:cloudflare
```

## Notes

- Configuration lives in `wrangler.jsonc`.
- The deploy flow runs `npm run build:cloudflare`, which builds `shared` and `frontend`.
- The Worker handles static assets, UU API forwarding, and signal endpoints. Remote media does not pass through the Worker.
