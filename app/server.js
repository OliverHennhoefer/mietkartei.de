// Starts the node build (self-hosting). SvelteKit 3 derives the public origin from the request
// headers and assumes https, which would fail its CSRF check for form posts to this plain http
// server. So the origin is http plus the Host header by default, and ORIGIN states the public
// URL when the app runs behind a reverse proxy, e.g. one that terminates https.
import http from 'node:http';
import process from 'node:process';

const origin = process.env.ORIGIN ? new URL(process.env.ORIGIN) : undefined;

// Read by build/handler.js when it is imported, so set them first.
process.env.PROTOCOL_HEADER = 'x-mietkartei-protocol';
if (origin) process.env.HOST_HEADER = 'x-mietkartei-host';
// Documents up to 10 MB are uploaded; the adapter's default limit would refuse them with 413.
process.env.BODY_SIZE_LIMIT ??= '12M';

const { handler } = await import('./build/handler.js');

const server = http.createServer((req, res) => {
	req.headers['x-mietkartei-protocol'] = origin ? origin.protocol.slice(0, -1) : 'http';
	if (origin) req.headers['x-mietkartei-host'] = origin.host;
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
	// Without ORIGIN the Host header of each request names the app, and anyone can send any Host,
	// so password reset mails only go out for requests to localhost.
	if (!origin) console.warn('ORIGIN is not set: password reset mails only work at localhost.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		server.close(() => process.exit(0));
		server.closeIdleConnections();
		setTimeout(() => process.exit(0), 10_000).unref();
	});
}
