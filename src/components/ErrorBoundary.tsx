import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";
import { JellyfinMark } from "./JellyfinLogo";

const RELOADED_KEY = "argent.chunkReload";

/** A lazy route chunk that no longer exists, usually because a new build was deployed. */
function isChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch dynamically/i.test(message);
}

interface Props {
  children: ReactNode;
  /** Changing this clears the error (the route boundary passes the pathname). */
  resetKey?: string;
  /** Whole-screen fallback for the root boundary; route boundaries render inside the shell. */
  fullScreen?: boolean;
}

interface State {
  error: unknown;
  resetKey?: string;
}

/**
 * Catches rendering errors so one broken screen doesn't blank the whole app (there's
 * no address bar to recover from on TV or in the desktop app).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error("Unknown error") };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Navigating somewhere else gives the new screen a fresh start.
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Argent hit a rendering error", error, info.componentStack);
    // After a deploy, old chunks are gone: reload once to pick up the new build.
    if (isChunkError(error)) {
      let reloaded = false;
      try {
        reloaded = sessionStorage.getItem(RELOADED_KEY) === "1";
        sessionStorage.setItem(RELOADED_KEY, "1");
      } catch {
        /* ignore */
      }
      if (!reloaded) window.location.reload();
    }
  }

  componentDidUpdate(_prev: Props, prevState: State) {
    if (prevState.error && !this.state.error) {
      try {
        sessionStorage.removeItem(RELOADED_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkError(error);
    const message = chunk ? "Argent was updated while this page was open." : error instanceof Error ? error.message : "Something went wrong.";
    return (
      <div className={this.props.fullScreen ? "crash crash--full" : "crash"} role="alert" data-nav-trap={this.props.fullScreen || undefined}>
        <JellyfinMark size={44} />
        <h2 className="crash__title">{chunk ? "A new version is available" : "This screen ran into a problem"}</h2>
        <p className="crash__body">{message}</p>
        <div className="crash__actions">
          {!chunk && (
            <Button variant="primary" onClick={this.retry} data-autofocus>
              Try again
            </Button>
          )}
          <Button variant={chunk ? "primary" : "secondary"} onClick={() => window.location.reload()}>
            Reload Argent
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              window.location.href = import.meta.env.BASE_URL;
            }}
          >
            Go home
          </Button>
        </div>
      </div>
    );
  }
}
