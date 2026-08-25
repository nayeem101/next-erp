/** @vitest-environment node */
import { Suspense } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, test } from "vitest";

/**
 * Streaming semantics smoke: a deliberately slow widget must not delay
 * the shell or its already-ready siblings. Mirrors the page's per-widget
 * Suspense composition.
 */

function FastWidget(): React.JSX.Element {
  return <section data-testid="fast">recent-orders-ready</section>;
}

const slowGate = new Promise<void>((resolve) => {
  setTimeout(resolve, 120);
});

async function SlowWidget(): Promise<React.JSX.Element> {
  await slowGate;

  return <section data-testid="slow">revenue-ready</section>;
}

function Shell(): React.JSX.Element {
  return (
    <div>
      <h1>dashboard-shell</h1>
      <Suspense fallback={<p>loading recent orders</p>}>
        <FastWidget />
      </Suspense>
      <Suspense fallback={<p>loading revenue</p>}>
        <SlowWidget />
      </Suspense>
    </div>
  );
}

describe("dashboard streaming", () => {
  test("shell and fast siblings flush before a slow aggregate resolves", async () => {
    const stream = await renderToReadableStream(<Shell />);
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let buffered = "";
    const seen = { shell: false, fast: false, slowBeforeFast: false };

    for (;;) {
      const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read();

      if (chunk.done) break;

      buffered += decoder.decode(chunk.value, { stream: true });

      if (buffered.includes("dashboard-shell")) {
        seen.shell = true;
      }
      if (buffered.includes("recent-orders-ready")) {
        seen.fast = true;
      }
      if (!seen.fast && buffered.includes("revenue-ready")) {
        seen.slowBeforeFast = true;
      }
    }

    expect(seen.shell).toBe(true);
    expect(seen.fast).toBe(true);
    expect(seen.slowBeforeFast).toBe(false);
    expect(buffered).toContain("revenue-ready");
  });
});
