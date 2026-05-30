import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { HavenMatrixLogo } from '../shared/HavenMatrixLogo';

export function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [tab,      setTab]      = useState<'login' | 'register'>('login');
  const [email,    setEmail]    = useState('');
  const [name,     setName]     = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  const handle = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (tab === 'login') {
        await login(email.trim(), password);
      } else {
        if (!name.trim()) { setError('Name is required.'); setLoading(false); return; }
        await register(email.trim(), name.trim(), password);
      }
      navigate('/caseworker', { replace: true });
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || (tab === 'login' ? 'Invalid email or password.' : 'Registration failed.'));
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%',
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(56,174,210,0.35)',
    borderRadius: 10,
    color: 'white',
    padding: '10px 14px',
    fontSize: 14,
    outline: 'none',
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #0D2436 60%, #061825 100%)' }}>

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 gap-2">
          <HavenMatrixLogo size={48} />
          <h1 className="text-2xl font-bold tracking-tight text-white">Haven Matrix</h1>
          <p className="text-xs tracking-widest uppercase" style={{ color: 'rgba(114,200,226,0.6)' }}>
            Caseworker Portal
          </p>
        </div>

        {/* Tab toggle */}
        <div className="flex rounded-xl overflow-hidden mb-6"
          style={{ border: '1px solid rgba(56,174,210,0.25)', background: 'rgba(255,255,255,0.04)' }}>
          {(['login', 'register'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setError(null); }}
              className="flex-1 py-2.5 text-sm font-semibold transition-all"
              style={tab === t
                ? { background: 'rgba(26,147,187,0.35)', color: '#72C8E2' }
                : { color: 'rgba(255,255,255,0.4)' }}>
              {t === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handle} className="space-y-3">
          <input
            type="email" required autoComplete="email"
            placeholder="Email address"
            value={email} onChange={e => setEmail(e.target.value)}
            style={inputStyle}
          />
          {tab === 'register' && (
            <input
              type="text" required autoComplete="name"
              placeholder="Your full name"
              value={name} onChange={e => setName(e.target.value)}
              style={inputStyle}
            />
          )}
          <input
            type="password" required autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
            placeholder="Password"
            value={password} onChange={e => setPassword(e.target.value)}
            style={inputStyle}
          />

          {error && (
            <div className="text-sm rounded-lg px-3 py-2"
              style={{ background: 'rgba(239,68,68,0.12)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.25)' }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-sm transition-all mt-2"
            style={{
              background: loading ? 'rgba(26,147,187,0.2)' : 'linear-gradient(135deg, #0F4259, #1A7A9A)',
              color: loading ? 'rgba(114,200,226,0.5)' : 'white',
              boxShadow: loading ? 'none' : '0 4px 16px rgba(15,66,89,0.5)',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}>
            {loading ? 'Please wait…' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-xs mt-6" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Kiosk doesn't require login —{' '}
          <a href="/kiosk" className="underline" style={{ color: 'rgba(114,200,226,0.4)' }}>open kiosk</a>
        </p>
      </div>
    </div>
  );
}
