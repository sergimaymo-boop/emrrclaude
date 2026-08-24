interface LoginPageProps {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  return (
    <main className="login-shell">
      <section className="login-panel">
        <p className="login-eyebrow">INSTITUTIONAL TREND DASHBOARD</p>
        <h1 className="login-title">EMRR</h1>
        <div className="login-divider" />
        <div className="login-meta">
          <span className="login-meta-item"><span className="login-dot" />YAHOO</span>
          <span className="login-meta-sep" />
          <span className="login-meta-item"><span className="login-dot" />FINNHUB</span>
          <span className="login-meta-sep" />
          <span className="login-meta-item">LIVE DATA</span>
        </div>
        <p className="login-copy">
          Real-time global market scanner. TOP 8 institutional trend ranking with full universe coverage.
        </p>
        <button className="primary-button login-enter-btn" type="button" onClick={onLogin}>
          ENTER DASHBOARD
        </button>
        <p className="login-footnote">emrrclaude.vercel.app</p>
      </section>
    </main>
  );
}
