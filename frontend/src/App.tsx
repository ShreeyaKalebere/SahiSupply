import { Route, Routes } from "react-router-dom";
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
import OverviewPage from "./pages/OverviewPage";
import PlannerPage from "./pages/PlannerPage";
import ScenariosPage from "./pages/ScenariosPage";

export default function App() {
  return (
    <PlannerProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="planner" element={<PlannerPage />} />
          <Route path="comparison" element={<ComparisonPage />} />
          <Route path="scenarios" element={<ScenariosPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="forecast" element={<ForecastPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="map" element={<MapPage />} />
          <Route path="config" element={<ConfigPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="export" element={<ExportPage />} />
          <Route path="*" element={<OverviewPage />} />
        </Route>
      </Routes>
    </PlannerProvider>
  );
}
