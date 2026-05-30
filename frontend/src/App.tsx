import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CaseworkerPage } from './components/GatewayA/CaseworkerPage';
import { KioskPage }      from './components/GatewayB/KioskPage';
import { LoginPage }      from './components/Auth/LoginPage';

function ProtectedCaseworker() {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ background: '#0A1E2E' }}>
      <div className="text-sm font-medium" style={{ color: 'rgba(114,200,226,0.5)' }}>Loading…</div>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return <CaseworkerPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login"      element={<LoginPage />} />
          <Route path="/caseworker" element={<ProtectedCaseworker />} />
          <Route path="/kiosk"      element={<KioskPage />} />
          <Route path="*"           element={<Navigate to="/caseworker" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
