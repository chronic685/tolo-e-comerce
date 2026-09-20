import { useSearchParams } from "react-router-dom";
import { Commissions } from "./Commissions";
import { Discounts } from "./Discounts";

// Consolidates two previously separate nav entries (Commissions, Discounts)
// into one "Pricing Rules" section, same tabbed pattern as DeliveryOps.tsx.
// Each tab renders the existing page component unmodified aside from the
// edit-mode addition made alongside this merge — this is a navigation/
// layout merge, not a rewrite of either page's logic.
const TABS = [
  { key: "discounts", label: "Discounts" },
  { key: "commissions", label: "Commissions" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((t) => t.key === value);
}

export function PricingRules() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  // Discounts is the default/landing tab — promotions get created/edited/
  // toggled far more often than commission rates, which are closer to a
  // set-once platform default (see Commissions.tsx: usually just "platform").
  const activeTab: TabKey = isTabKey(tabParam) ? tabParam : "discounts";

  function setTab(tab: TabKey) {
    setSearchParams(tab === "discounts" ? {} : { tab });
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Pricing Rules</h1>
      <div className="flex items-center gap-1 border-b mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === t.key ? "border-navy text-navy" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "commissions" && <Commissions />}
      {activeTab === "discounts" && <Discounts />}
    </div>
  );
}
