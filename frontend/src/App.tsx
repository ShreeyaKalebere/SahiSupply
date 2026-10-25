import { DeliveriesProvider } from "./hooks/useDeliveries";
import { Navigate, Route, Routes } from "react-router-dom";
import { isNativeApp } from "./api/client";
import { PlannerProvider } from "./hooks/usePlanner";
import { AppLayout } from "./layouts/AppLayout";
import ComparisonPage from "./pages/ComparisonPage";
import ConfigPage from "./pages/ConfigPage";
import ExportPage from "./pages/ExportPage";
import ForecastPage from "./pages/ForecastPage";
import HistoryPage from "./pages/HistoryPage";
import InsightsPage from "./pages/InsightsPage";
import InventoryPage from "./pages/InventoryPage";
import MapPage from "./pages/MapPage";
import NetworkPage from "./pages/NetworkPage";
import OverviewPage from "./pages/OverviewPage";
import PlannerPage from "./pages/PlannerPage";
import MobileApp from "./mobile/MobileApp";
import RescuePage from "./pages/RescuePage";
import ScenariosPage from "./pages/ScenariosPage";
import TracePage from "./pages/TracePage";
import RoutePlannerPage from "./pages/RoutePlannerPage";

export default function App() {
  return (
    <PlannerProvider>
      <DeliveriesProvider>
      <Routes>
        <Route path="m/*" element={<MobileApp />} />
        <Route element={<AppLayout />}>
          {/* The Android app opens on the field (mobile) screens; the full dashboard stays reachable. */}
          <Route index element={isNativeApp() ? <Navigate to="/m" replace /> : <OverviewPage />} />
          <Route path="planner" element={<PlannerPage />} />
          <Route path="network" element={<NetworkPage />} />
          <Route path="comparison" element={<ComparisonPage />} />
          <Route path="scenarios" element={<ScenariosPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="forecast" element={<ForecastPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="map" element={<MapPage />} />
          <Route path="rescue" element={<RescuePage />} />
          <Route path="trace" element={<TracePage />} />
          <Route path="routes" element={<RoutePlannerPage />} />
          <Route path="config" element={<ConfigPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="export" element={<ExportPage />} />
          <Route path="*" element={<OverviewPage />} />
        </Route>
      </Routes>
      </DeliveriesProvider>
    </PlannerProvider>
  );
}
