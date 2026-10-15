import { Component, type ReactNode } from "react";
import { Alert } from "./primitives";

interface State {
  error?: Error;
}

/** Shows a readable message instead of a blank page when rendering fails. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(JSON.stringify({ event: "ui_error", name: error.name, message: error.message }));
  }

  render() {
    if (this.state.error) {
      return (
        <main className="shell-main">
          <Alert tone="error">Something went wrong. Reload the page to try again.</Alert>
        </main>
      );
    }
    return this.props.children;
  }
}
