import { NAV_ITEMS } from '@resellpilot/shared';
import type { ComponentType } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { EmptyPage } from './pages/EmptyPage';
import { Inventario } from './pages/Inventario';
import { Resumen } from './pages/Resumen';

/** Páginas ya construidas. El resto de la navegación sigue vacío hasta su fase. */
const PAGES: Record<string, ComponentType> = {
  '/': Resumen,
  '/inventario': Inventario,
};

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<Layout />}>
          {NAV_ITEMS.map((item, index) => {
            const Page = PAGES[item.path];
            return (
              <Route
                key={item.path}
                path={item.path}
                element={Page ? <Page /> : <EmptyPage item={item} index={index + 1} />}
              />
            );
          })}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
