import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import langfuse from "../examples/extensions/langfuse.js";
import type { ExtensionAPI, ExtensionContext } from "../src/core/extensions/types.js";

afterEach(() => vi.unstubAllEnvs());
it.each([false, true])("exports without prompt content (collector=%s)", async (collector) => {
	let received: unknown;
	const server = createServer(async (req, res) => {
		let body = "";
		for await (const chunk of req) body += chunk;
		received = {
			path: req.url,
			auth: req.headers.authorization,
			version: req.headers["x-langfuse-ingestion-version"],
			body: JSON.parse(body),
		};
		res.end("{}");
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	try {
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("missing server address");
		vi.stubEnv("PI_LANGFUSE_ENABLED", "1");
		vi.stubEnv("LANGFUSE_HOST", collector ? "" : `http://127.0.0.1:${address.port}`);
		vi.stubEnv("PI_OTEL_TRACE_ENDPOINT", collector ? `http://127.0.0.1:${address.port}/v1/traces` : "");
		vi.stubEnv("PI_OTEL_AUTHORIZATION", collector ? "Basic collector-test" : "");
		vi.stubEnv("LANGFUSE_PUBLIC_KEY", "test-public");
		vi.stubEnv("LANGFUSE_SECRET_KEY", "test-secret");
		const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
		langfuse({
			on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) =>
				handlers.set(event, handler),
		} as unknown as ExtensionAPI);
		const ctx = {
			model: { id: "test-model" },
			sessionManager: { getSessionId: () => "test-session" },
		} as ExtensionContext;
		await handlers.get("agent_start")?.({}, ctx);
		await handlers.get("agent_end")?.({ messages: [{ content: "private-prompt" }] }, ctx);
		expect(received).toMatchObject({
			path: collector ? "/v1/traces" : "/api/public/otel/v1/traces",
			auth: collector
				? "Basic collector-test"
				: `Basic ${Buffer.from("test-public:test-secret").toString("base64")}`,
			version: "4",
			body: {
				resourceSpans: [
					{
						scopeSpans: [
							{
								spans: [
									{
										name: "pi.agent",
										traceId: expect.stringMatching(/^[a-f0-9]{32}$/),
										spanId: expect.stringMatching(/^[a-f0-9]{16}$/),
									},
								],
							},
						],
					},
				],
			},
		});
		expect(JSON.stringify(received)).not.toContain("private-prompt");
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
});
it("is disabled by default", () => {
	vi.stubEnv("PI_LANGFUSE_ENABLED", "");
	const on = vi.fn();
	langfuse({ on } as unknown as ExtensionAPI);
	expect(on).not.toHaveBeenCalled();
});
