/** The first text has already been generated, so partial/cancelled streams count.
 * Explicit error events prevent interrupted output from being auto-saved as a success. */
export function aiTextStream(first: string, iterator: AsyncIterator<string>, abort: () => void,
    finish: (success: boolean) => Promise<void>): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let cancelled = false;
    return new ReadableStream({
        async start(controller) {
            const event = (body: unknown) => {
                if (!cancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(body)}\n\n`));
            };
            const delta = (text: string) => event({ type: 'content_block_delta', delta: { type: 'text_delta', text } });
            try {
                delta(first);
                for (let next = await iterator.next(); !next.done; next = await iterator.next()) delta(next.value);
                event({ type: 'message_stop' });
            } catch {
                event({ type: 'error', error: 'Analysis was interrupted. Please try again.' });
            } finally {
                abort();
                await finish(true);
                if (!cancelled) controller.close();
            }
        },
        async cancel() { cancelled = true; abort(); await finish(true); },
    });
}
