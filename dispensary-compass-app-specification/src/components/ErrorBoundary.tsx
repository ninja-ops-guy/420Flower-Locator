import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { failed: boolean }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep failures visible to the operator without transmitting user data.
    console.error("COMPASS render failure", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "#0e100e",
        color: "#eef3ec",
        fontFamily: "system-ui, sans-serif",
      }}>
        <section style={{ maxWidth: 520 }}>
          <p style={{ letterSpacing: ".18em", fontSize: 12, color: "#6ee7b7" }}>COMPASS · SAFE FALLBACK</p>
          <h1 style={{ fontSize: 32, margin: "8px 0" }}>The interface hit an unexpected error.</h1>
          <p style={{ lineHeight: 1.6, color: "#cbd5cb" }}>
            Your location was not uploaded to a COMPASS account or profile. Reload the application to restart the local session.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16,
              border: 0,
              borderRadius: 12,
              padding: "12px 16px",
              fontWeight: 800,
              cursor: "pointer",
              background: "#34d399",
              color: "#052e22",
            }}
          >
            Reload COMPASS
          </button>
        </section>
      </main>
    );
  }
}
