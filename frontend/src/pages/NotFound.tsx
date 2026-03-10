const NotFound = () => (
  <>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #0f0c1a; }

      .nf-page {
        font-family: 'DM Sans', sans-serif;
        min-height: 100vh; display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        background: #0f0c1a; position: relative; overflow: hidden;
        padding: 24px;
      }

      /* Orbs */
      .nf-orb1 { position: fixed; border-radius: 50%; pointer-events: none; z-index: 0;
        width: 700px; height: 700px;
        background: radial-gradient(circle, rgba(124,58,237,0.2) 0%, transparent 65%);
        top: -200px; left: -150px; animation: nfDrift1 9s ease-in-out infinite alternate; }
      .nf-orb2 { position: fixed; border-radius: 50%; pointer-events: none; z-index: 0;
        width: 500px; height: 500px;
        background: radial-gradient(circle, rgba(244,114,182,0.12) 0%, transparent 65%);
        bottom: -120px; right: -100px; animation: nfDrift2 12s ease-in-out infinite alternate; }
      @keyframes nfDrift1 { from{transform:translate(0,0)} to{transform:translate(40px,30px) scale(1.08)} }
      @keyframes nfDrift2 { from{transform:translate(0,0)} to{transform:translate(-30px,-20px) scale(1.1)} }

      /* Grid */
      .nf-grid { position: fixed; inset: 0; z-index: 1; pointer-events: none;
        background-image: linear-gradient(rgba(167,139,250,0.04) 1px, transparent 1px),
                          linear-gradient(90deg, rgba(167,139,250,0.04) 1px, transparent 1px);
        background-size: 48px 48px; }

      .nf-content { position: relative; z-index: 2; text-align: center; max-width: 480px; }

      /* Logo */
      .nf-logo { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 48px; }
      .nf-logo-bars { display: flex; gap: 3px; align-items: flex-end; }
      .nf-logo-bars span { display: block; width: 4px; border-radius: 2px; }
      .nf-logo-name { font-family: 'Syne', sans-serif; font-size: 19px; font-weight: 800; color: white; letter-spacing: -0.3px; }
      .nf-logo-name em { font-style: normal; color: #c4b5fd; }

      /* 404 number */
      .nf-number {
        font-family: 'Syne', sans-serif; font-size: 120px; font-weight: 800;
        line-height: 1; letter-spacing: -6px; margin-bottom: 8px;
        background: linear-gradient(135deg, #c4b5fd, #f472b6, #67e8f9, #a78bfa, #c4b5fd);
        background-size: 300%; -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        animation: nfGrad 5s ease infinite;
        filter: drop-shadow(0 0 40px rgba(196,181,253,0.25));
      }
      @keyframes nfGrad { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }

      /* Divider line */
      .nf-line { width: 60px; height: 2px; background: linear-gradient(90deg, #c4b5fd, #f472b6); border-radius: 2px; margin: 0 auto 24px; }

      .nf-title { font-family: 'Syne', sans-serif; font-size: 22px; font-weight: 800; color: white; letter-spacing: -0.5px; margin-bottom: 10px; }
      .nf-sub { font-size: 13.5px; color: rgba(196,181,253,0.45); font-weight: 300; line-height: 1.7; margin-bottom: 36px; }

      /* Buttons */
      .nf-actions { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; }

      .nf-btn-primary {
        height: 46px; padding: 0 28px; display: flex; align-items: center; gap: 8px;
        background: linear-gradient(135deg, #7c3aed, #a855f7, #ec4899);
        background-size: 200%; border: none; border-radius: 13px;
        font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600; color: white;
        cursor: pointer; transition: all 0.3s; box-shadow: 0 6px 22px rgba(124,58,237,0.3);
        text-decoration: none;
      }
      .nf-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(168,85,247,0.4); }

      .nf-btn-ghost {
        height: 46px; padding: 0 28px; display: flex; align-items: center; gap: 8px;
        background: transparent; border: 1.5px solid rgba(167,139,250,0.2);
        border-radius: 13px; font-family: 'DM Sans', sans-serif; font-size: 14px;
        font-weight: 600; color: rgba(196,181,253,0.6);
        cursor: pointer; transition: all 0.25s; text-decoration: none;
      }
      .nf-btn-ghost:hover { border-color: rgba(196,181,253,0.4); color: #c4b5fd; background: rgba(167,139,250,0.07); }

      /* Floating glitch effect on 404 */
      .nf-number { animation: nfGrad 5s ease infinite, nfFloat 4s ease-in-out infinite; }
      @keyframes nfFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
    `}</style>

    <div className="nf-page">
      <div className="nf-orb1" />
      <div className="nf-orb2" />
      <div className="nf-grid" />

      <div className="nf-content">

        {/* Logo */}
        <div className="nf-logo">
          <div className="nf-logo-bars">
            <span style={{height:'10px',background:'#7c3aed'}} />
            <span style={{height:'16px',background:'#a855f7'}} />
            <span style={{height:'24px',background:'#c4b5fd'}} />
            <span style={{height:'18px',background:'#f472b6'}} />
            <span style={{height:'12px',background:'#e879f9',opacity:0.7}} />
            <span style={{height:'7px',background:'#c4b5fd',opacity:0.4}} />
          </div>
          <span className="nf-logo-name"><em>Skill</em>Pulse</span>
        </div>

        {/* 404 */}
        <div className="nf-number">404</div>
        <div className="nf-line" />

        <div className="nf-title">Page not found</div>
        <p className="nf-sub">
          Looks like this page took an unexpected detour.<br/>
          Let's get you back on track.
        </p>

        <div className="nf-actions">
          <a className="nf-btn-primary" href="/" onClick={e => { e.preventDefault(); window.location.href = '/'; }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            Back to Home
          </a>
          <a className="nf-btn-ghost" href="/register" onClick={e => { e.preventDefault(); window.location.href = '/register'; }}>
            Create Account
          </a>
        </div>

      </div>
    </div>
  </>
);

export default NotFound;
