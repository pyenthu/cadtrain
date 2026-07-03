/**
 * Production entry — adapter-node server + app-wide cross-origin isolation
 * headers on EVERY response, including static assets.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * TrueForm (pthreads) needs a cross-origin-isolated document
 * (`self.crossOriginIsolated === true`), which requires
 *   Cross-Origin-Opener-Policy:   same-origin
 *   Cross-Origin-Embedder-Policy: require-corp
 * on the top-level document. `src/hooks.server.ts` sets those on SvelteKit's
 * SSR responses — but adapter-node serves `/_app/immutable/**` (hashed JS
 * chunks, the client-bake Web Worker, wasm) through its OWN sirv middleware,
 * which runs BEFORE `handle` and never reaches the hook. So static assets ship
 * WITHOUT the headers.
 *
 * That breaks the client-side bake worker: a dedicated Worker created from a
 * `require-corp` document MUST itself be delivered with
 * `Cross-Origin-Embedder-Policy: require-corp` (it has to inherit the
 * isolation), otherwise the browser blocks the worker script fetch with
 * `net::ERR_BLOCKED_BY_RESPONSE` and the only signal is an empty `error` event
 * ("bake worker error: unknown"). CORP alone is NOT sufficient — empirically
 * only COEP on the worker response unblocks it (2026-07-03 repro). The client
 * then silently falls back to server bake, disabling the 💻 client executor in
 * prod.
 *
 * THE FIX
 * -------
 * Patch `http.ServerResponse#writeHead` to inject COOP + COEP if not already
 * present, then boot the UNMODIFIED adapter-node server (`build/index.js`). We
 * wrap `writeHead` (the single choke point every response — explicit or
 * implicit — passes through) rather than reimplementing adapter-node's server,
 * so polka routing, socket activation, graceful shutdown and the body-size /
 * timeout env handling are all preserved. Idempotent: SSR responses already
 * carry the headers from hooks.server.ts, so we skip them (getHeader guard) and
 * never double-set. Same-origin app → COEP is safe on every asset; we do NOT
 * add CORP (unneeded here, and CORP:same-origin would interfere with the
 * optional cross-origin CORS surface).
 */
import http from 'node:http';

const ISOLATION_HEADERS = {
	'cross-origin-opener-policy': 'same-origin',
	'cross-origin-embedder-policy': 'require-corp',
};

const originalWriteHead = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function patchedWriteHead(...args) {
	try {
		if (!this.headersSent) {
			for (const [name, value] of Object.entries(ISOLATION_HEADERS)) {
				if (!this.getHeader(name)) this.setHeader(name, value);
			}
		}
	} catch {
		/* never let header injection break a response */
	}
	return originalWriteHead.apply(this, args);
};

// Boot the real adapter-node server (self-executes on import: reads HOST/PORT/
// SOCKET_PATH, starts polka + handler, wires SIGTERM/SIGINT graceful shutdown).
await import('./build/index.js');
