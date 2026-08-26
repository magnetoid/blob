/** Sign in, sign up, first-run workspace setup, and password recovery.
 *
 * Recovery was the one path that existed on the server and nowhere else. `POST
 * /api/auth/forgot-password` mints a one-hour token, hashes it, and emails a link to
 * `PUBLIC_URL/reset/<token>` — and the client's router had no `/reset/` case, so that
 * link fell through to the conversation view and the token was discarded in silence.
 * Somebody who forgot their password was locked out of a self-hosted workspace with no
 * way back in and an email in their inbox that appeared to be broken. These are the two
 * screens that email needed.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api.ts";
import { inviteTokenFromUrl, resetTokenFromUrl } from "./tokens.ts";

type Mode = "login" | "signup" | "forgot" | "reset";

interface Props {
  needsSetup: boolean;
  onSignedIn: () => Promise<void>;
}

export function AuthScreen({ needsSetup, onSignedIn }: Props) {
  const inviteToken = inviteTokenFromUrl();
  const resetToken = resetTokenFromUrl();
  const workspaceNameRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>(
    resetToken ? "reset" : needsSetup || inviteToken ? "signup" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [inviteWorkspace, setInviteWorkspace] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    void api.auth
      .invite(inviteToken)
      .then((invite) => {
        setInviteWorkspace(invite.workspace);
        if (invite.email) setEmail(invite.email);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError
            ? err.message
            : "That invitation is not valid.",
        );
      });
  }, [inviteToken]);

  useEffect(() => {
    if (!needsSetup) return;
    workspaceNameRef.current?.focus();
  }, [needsSetup]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      switch (mode) {
        case "login":
          await api.auth.login(email, password);
          break;
        case "signup":
          await api.auth.signup({
            email,
            password,
            displayName,
            workspaceName: needsSetup ? workspaceName || "Workspace" : undefined,
            inviteToken: inviteToken ?? undefined,
          });
          break;
        case "forgot":
          // Always answers ok, whether or not the address has an account — so the
          // screen must not imply one either way. Nothing to sign in to yet.
          await api.auth.forgotPassword(email);
          setSent(true);
          setBusy(false);
          return;
        case "reset":
          if (!resetToken) return;
          // The server sets a fresh session cookie on success, having deleted every
          // old one. So a completed reset is also a sign-in, which is the behaviour
          // somebody clicking a link from their inbox expects.
          await api.auth.resetPassword(resetToken, password);
          break;
      }
      // Drop a one-shot token from the URL so a refresh doesn't retry it.
      if (inviteToken || resetToken) window.history.replaceState(null, "", "/");
      await onSignedIn();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Try again.",
      );
      setBusy(false);
    }
  }

  const title = needsSetup
    ? "Set up your workspace"
    : mode === "reset"
      ? "Choose a new password"
      : mode === "forgot"
        ? "Reset your password"
        : mode === "login"
          ? "Sign in"
          : inviteWorkspace
            ? `Join ${inviteWorkspace}`
            : "Create your account";

  // A sent recovery email is a dead end by design: the next step is in their inbox, and
  // leaving the form up invites them to send it again while the first is in flight.
  if (mode === "forgot" && sent) {
    return (
      <div className="auth">
        <div className="auth-card">
          <div>
            <div className="auth-mark" aria-hidden="true">
              B
            </div>
            <h1 className="auth-title" style={{ marginTop: 18 }}>
              Check your email
            </h1>
            <p className="auth-subtitle">
              If {email} has an account here, a link to choose a new password is
              on its way. It expires in an hour.
            </p>
          </div>
          <p className="auth-switch">
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setMode("login");
              }}
            >
              Back to sign in
            </button>
          </p>
        </div>
      </div>
    );
  }

  const needsEmail = mode !== "reset";
  const needsPassword = mode !== "forgot";

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div>
          <div className="auth-mark" aria-hidden="true">
            B
          </div>
          <h1 className="auth-title" style={{ marginTop: 18 }}>
            {title}
          </h1>
          {needsSetup && (
            <p className="auth-subtitle">
              You're the first person here, so this account becomes the
              workspace owner.
            </p>
          )}
          {mode === "forgot" && (
            <p className="auth-subtitle">
              We'll email you a link. It works once and expires in an hour.
            </p>
          )}
          {mode === "reset" && (
            <p className="auth-subtitle">
              This signs you out everywhere else, on every workspace this
              address belongs to.
            </p>
          )}
        </div>

        {needsSetup && (
          <label className="field">
            <span className="field-label">Workspace name</span>
            <input
              ref={workspaceNameRef}
              className="input"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="Acme"
            />
          </label>
        )}

        {mode === "signup" && (
          <label className="field">
            <span className="field-label">Display name</span>
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ana"
              required
              maxLength={40}
            />
          </label>
        )}

        {needsEmail && (
          <label className="field">
            <span className="field-label">Email</span>
            {/* Only on login: first-run and invites open in signup, where the
                workspace-name field already takes focus. */}
            <input
              className="input"
              type="email"
              autoFocus={mode === "login"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
        )}

        {needsPassword && (
          <div className="field">
            {/* Explicit association: with the show/hide button inside an implicit
                label, the label labelled two controls and screen readers (and tests)
                could not tell which one was the password. */}
            <label className="field-label" htmlFor="auth-password">
              {mode === "reset" ? "New password" : "Password"}
            </label>
            <span style={{ display: "flex", gap: 6 }}>
              <input
                id="auth-password"
                className="input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === "login" ? 1 : 10}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </span>
            {mode !== "login" && (
              <span className="muted" style={{ fontSize: 13 }}>
                At least 10 characters.
              </span>
            )}
          </div>
        )}

        {error && (
          <p className="error-text" aria-live="polite">
            {error}
          </p>
        )}

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy
            ? "Working…"
            : mode === "login"
              ? "Sign in"
              : mode === "signup"
                ? "Create account"
                : mode === "forgot"
                  ? "Email me a link"
                  : "Save and sign in"}
        </button>

        {mode === "login" && !needsSetup && (
          <p className="auth-switch">
            <button type="button" onClick={() => setMode("forgot")}>
              Forgot your password?
            </button>
          </p>
        )}

        {(mode === "forgot" || mode === "reset") && (
          <p className="auth-switch">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setPassword("");
                // Abandoning a reset is a real navigation rather than a mode change:
                // the token in the path is what pins this screen up, and whoever
                // abandoned it may still hold a valid session. Reloading at / lets
                // bootstrap decide between the workspace and the sign-in form
                // instead of assuming they are signed out.
                if (resetToken) window.location.replace("/");
                else setMode("login");
              }}
            >
              Back to sign in
            </button>
          </p>
        )}

        {!needsSetup && !inviteToken && (mode === "login" || mode === "signup") && (
          <p className="auth-switch">
            {mode === "login" ? (
              <>
                Have an invitation?{" "}
                <button type="button" onClick={() => setMode("signup")}>
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already here?{" "}
                <button type="button" onClick={() => setMode("login")}>
                  Sign in
                </button>
              </>
            )}
          </p>
        )}
      </form>
    </div>
  );
}
