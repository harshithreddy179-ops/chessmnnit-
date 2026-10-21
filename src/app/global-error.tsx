"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#0d0e0d", color: "#efeadf", display: "grid", minHeight: "100dvh", placeItems: "center", margin: 0 }}>
        <main style={{ maxWidth: 480, padding: 24, textAlign: "center" }}>
          <h1>MNNIT Chess hit a problem</h1>
          <p>Something went badly wrong. Please reload the page.</p>
          <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "#2fb585", color: "#04130c", fontWeight: 600 }}>Reload</button>
        </main>
      </body>
    </html>
  );
}
