import { useSearchParams } from "react-router-dom";
import { useTranslation } from "@tolo/ui";
import { Deliveries } from "./Deliveries";
import { Drivers } from "./Drivers";
import { DeliveryZones } from "./DeliveryZones";

// Consolidates three previously separate nav entries (Deliveries, Drivers,
// Delivery Zones) into one "Delivery Ops" section. Each tab renders the
// existing page component completely unmodified — this is a navigation/
// layout merge, not a rewrite, so each tab keeps every filter, action
// button, and data view exactly as it worked as a standalone page.
const TABS = [
  { key: "deliveries", labelKey: "deliveryOps.deliveriesTab" },
  { key: "drivers", labelKey: "deliveryOps.driversTab" },
  { key: "zones", labelKey: "deliveryOps.zonesTab" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((t) => t.key === value);
}

export function DeliveryOps() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  // Deliveries is the default/landing tab — it's the operationally active
  // one (assigning drivers, advancing status), unlike Drivers/Zones which
  // are occasional setup/config screens.
  const activeTab: TabKey = isTabKey(tabParam) ? tabParam : "deliveries";

  function setTab(tab: TabKey) {
    setSearchParams(tab === "deliveries" ? {} : { tab });
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">{t("deliveryOps.title")}</h1>
      <div className="flex items-center gap-1 border-b mb-4">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === tab.key ? "border-navy text-navy" : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300"
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {activeTab === "deliveries" && <Deliveries />}
      {activeTab === "drivers" && <Drivers />}
      {activeTab === "zones" && <DeliveryZones />}
    </div>
  );
}
