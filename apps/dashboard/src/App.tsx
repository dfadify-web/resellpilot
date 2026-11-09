import { NAV_ITEMS } from '@resellpilot/shared';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { EmptyPage } from './pages/EmptyPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {NAV_ITEMS.map((item, index) => (
            <Route
              key={item.path}
              path={item.path}
              element={<EmptyPage item={item} index={index + 1} />}
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
