export class RequestError extends Error {
    constructor(message: string, readonly status = 400) { super(message); }
}

/** Bound the bytes actually received; Content-Length alone is not trustworthy. */
export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
        throw new RequestError('Content-Type must be application/json.', 415);
    }
    if (Number(req.headers.get('content-length')) > maxBytes) throw new RequestError('Request is too large.', 413);
    if (!req.body) throw new RequestError('A JSON body is required.');
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let timedOut = false;
    // Slow/truncated uploads cannot hold an invocation open indefinitely.
    const deadline = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 10_000);
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
                await reader.cancel();
                throw new RequestError('Request is too large.', 413);
            }
            chunks.push(value);
        }
        if (timedOut) throw new RequestError('Request upload timed out.', 408);
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        try { return JSON.parse(new TextDecoder().decode(bytes)); }
        catch { throw new RequestError('Invalid JSON body.'); }
    } finally { clearTimeout(deadline); reader.releaseLock(); }
}
