// Starts the node build (self-hosting). SvelteKit 3 derives the public origin from the request
// headers and assumes https, so plain http access, e.g. on a home network, would fail its CSRF
// check. ORIGIN lets the operator state the public URL at runtime instead.
import http from 'node:http';
import process from 'node:process';

const origin = process.env.ORIGIN ? new URL(process.env.ORIGIN) : undefined;
if (origin) {
	// Read by build/handler.js when it is imported, so set them first.
	process.env.PROTOCOL_HEADER = 'x-mietkartei-protocol';
	process.env.HOST_HEADER = 'x-mietkartei-host';
}

const { handler } = await import('./build/handler.js');

const server = http.createServer((req, res) => {
	if (origin) {
		req.headers['x-mietkartei-protocol'] = origin.protocol.slice(0, -1);
		req.headers['x-mietkartei-host'] = origin.host;
	}
	handler(req, res, () => {
		res.statusCode = 404;
		res.end('Not found');
	});
});

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
server.listen(port, host, () => {
	console.log(
		`Listening on http://${host}:${port}${origin ? ` (public origin ${origin.origin})` : ''}`
	);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		server.close(() => process.exit(0));
		server.closeIdleConnections();
		setTimeout(() => process.exit(0), 10_000).unref();
	});
}
