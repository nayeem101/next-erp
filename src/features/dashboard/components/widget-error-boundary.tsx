"use client";

import { Component, type ReactNode } from "react";

/**
 * Local error boundary so one failed widget renders its own retry state
 * without unmounting sibling widgets.
 */
export class WidgetErrorBoundary extends Component<
  { children: ReactNode; title: string },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error(`[dashboard-widget] ${this.props.title} failed:`, error);
  }

  private readonly handleRetry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
          role="alert"
        >
          <p className="font-medium text-destructive">
            {this.props.title} could not load.
          </p>
          <button
            className="mt-2 text-xs underline underline-offset-4"
            onClick={this.handleRetry}
            type="button"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
