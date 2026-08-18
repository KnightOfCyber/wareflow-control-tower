import { Navigate, Route, Routes } from "react-router";
import { WarehouseProvider } from "@/lib/state/store";
import { CopilotProvider } from "@/lib/copilot/provider";
import { AppShell } from "@/components/shell/AppShell";
import ControlTower from "@/pages/ControlTower";
import Orders from "@/pages/Orders";
import Inventory from "@/pages/Inventory";
import DecisionCenter from "@/pages/DecisionCenter";
import Fulfillment from "@/pages/Fulfillment";
import Exceptions from "@/pages/Exceptions";
import Simulator from "@/pages/Simulator";
import Chaos from "@/pages/Chaos";
import Analytics from "@/pages/Analytics";
import Copilot from "@/pages/Copilot";

export default function App() {
  return (
    <WarehouseProvider>
      <CopilotProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<ControlTower />} />
            <Route path="orders" element={<Orders />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="decisions" element={<DecisionCenter />} />
            <Route path="fulfillment" element={<Fulfillment />} />
            <Route path="exceptions" element={<Exceptions />} />
            <Route path="simulator" element={<Simulator />} />
            <Route path="chaos" element={<Chaos />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="copilot" element={<Copilot />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </CopilotProvider>
    </WarehouseProvider>
  );
}
