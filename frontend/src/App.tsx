import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { CaseworkerPage } from './components/GatewayA/CaseworkerPage';
import { KioskPage }      from './components/GatewayB/KioskPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/caseworker" element={<CaseworkerPage />} />
        <Route path="/kiosk"      element={<KioskPage />} />
        <Route path="*"           element={<Navigate to="/caseworker" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
