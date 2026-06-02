import { FormEvent, useState } from "react";
import { validateDevPassword } from "../engines";

interface LoginPageProps {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // DEV ONLY LOCAL AUTH. This is not real authentication.
    if (validateDevPassword(password)) {
      setError("");
      onLogin();
      return;
    }

    setError("Incorrect dev password");
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <p className="eyebrow">DEV ONLY LOCAL AUTH</p>
        <h1>EMRR 2.0</h1>
        <p className="login-copy">Visual access for the current local beta. No backend, tokens, or external providers.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="password">Dev password</label>
          <input
            id="password"
            type="password"
            value={password}
            placeholder="emrr-dev"
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? <span className="form-error">{error}</span> : null}
          <button className="primary-button" type="submit">
            Enter
          </button>
        </form>
      </section>
    </main>
  );
}
