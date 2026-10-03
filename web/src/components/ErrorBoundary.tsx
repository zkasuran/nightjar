// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { Component, type ReactNode } from "react";

/** One broken view never blanks the whole site. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null });
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="wrap sec">
        <div className="empty" role="alert">
          <h2 className="h-m">This view hit an error</h2>
          <p className="mono t-s">{this.state.err.message.slice(0, 300)}</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn" onClick={() => this.setState({ err: null })}>Try again</button>
            <a className="btn" href="#/">Go home</a>
          </div>
        </div>
      </div>
    );
  }
}
