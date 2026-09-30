import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "../../i18n/useTranslation";
import { cn } from "../../lib/cn";

export interface CommandPaletteItem {
  key: string;
  label: string;
  to: string;
  icon?: LucideIcon;
  /** Section heading the item is grouped under, e.g. "Pages" or "Orders". */
  group: string;
}

export interface CommandPaletteProps {
  /** Every navigable page, already filtered to what the current user is
   * allowed to see -- e.g. admin passes ADMIN_PAGES filtered by
   * hasAccess(). CommandPalette does no permission-checking of its own; it
   * only ever shows/searches what it's handed. */
  pages: CommandPaletteItem[];
  /** Debounced remote search (orders/products) -- also expected to already
   * be scoped to what the caller is allowed to query. Optional: a palette
   * with no search callback just filters `pages`. */
  onSearch?: (query: string) => Promise<CommandPaletteItem[]>;
}

const SEARCH_DEBOUNCE_MS = 250;
const MIN_SEARCH_LENGTH = 2;

/** Imperative handle so a caller can also open the palette from a visible,
 * clickable button (not everyone discovers a keyboard-only shortcut) --
 * `<CommandPalette ref={paletteRef} .../>` then `paletteRef.current?.open()`. */
export interface CommandPaletteHandle {
  open: () => void;
}

/** Ctrl/Cmd+K command palette: jump to any page the current user can see,
 * and (optionally) search live results like orders/products. Built once so
 * merchant-dashboard and admin-dashboard don't each hand-roll their own
 * keyboard-nav/focus-trap/debounce logic. Every result the caller hands it
 * is trusted as already permission-scoped -- see `pages` and `onSearch`. */
export const CommandPalette = forwardRef<CommandPaletteHandle, CommandPaletteProps>(function CommandPalette({ pages, onSearch }, ref) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useImperativeHandle(ref, () => ({ open: () => setOpen(true) }), []);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CommandPaletteItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const listRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Global Ctrl/Cmd+K opens from anywhere in the app, same as every other
  // command palette (VS Code, Linear, Notion) -- the one keyboard shortcut
  // this codebase reserves globally.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      setQuery("");
      setSearchResults([]);
      setActiveIndex(0);
      // Wait a tick for the input to actually mount before focusing it.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      previouslyFocused.current?.focus?.();
    }
  }, [open]);

  useEffect(() => {
    if (!onSearch || query.trim().length < MIN_SEARCH_LENGTH) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const results = await onSearch(query.trim());
      if (!cancelled) setSearchResults(results);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, onSearch]);

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter((p) => p.label.toLowerCase().includes(q));
  }, [pages, query]);

  const flatItems = useMemo(() => [...filteredPages, ...searchResults], [filteredPages, searchResults]);

  useEffect(() => setActiveIndex(0), [flatItems.length, query]);

  function select(item: CommandPaletteItem) {
    navigate(item.to);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[activeIndex];
      if (item) select(item);
    }
  }

  useEffect(() => {
    const active = flatItems[activeIndex];
    // jsdom (unit tests) has no scrollIntoView implementation at all;
    // real browsers always do.
    listRefs.current.get(active?.key ?? "")?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, flatItems]);

  if (!open) return null;

  const groups = groupBy(flatItems);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh] px-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("commandPalette.placeholder")}
        className="relative w-full max-w-lg bg-white dark:bg-navy-dark rounded-lg shadow-popover overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 border-b dark:border-white/10">
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("commandPalette.placeholder")}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={flatItems[activeIndex] ? `cmdk-${flatItems[activeIndex].key}` : undefined}
            className="flex-1 py-3 text-sm bg-transparent outline-none dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>

        <div id="command-palette-list" role="listbox" className="max-h-80 overflow-y-auto p-1.5">
          {flatItems.length === 0 && <p className="text-sm text-gray-400 dark:text-gray-500 px-3 py-6 text-center">{t("commandPalette.noResults")}</p>}
          {groups.map(({ group, items }) => (
            <div key={group} className="mb-1 last:mb-0">
              <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{group}</p>
              {items.map((item) => {
                const index = flatItems.indexOf(item);
                const isActive = index === activeIndex;
                return (
                  <button
                    key={item.key}
                    id={`cmdk-${item.key}`}
                    ref={(el) => {
                      if (el) listRefs.current.set(item.key, el);
                    }}
                    role="option"
                    aria-selected={isActive}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(item)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-left",
                      isActive ? "bg-navy-50 dark:bg-navy-light/20 text-navy dark:text-navy-light" : "dark:text-gray-200",
                    )}
                  >
                    {item.icon && <item.icon className="w-4 h-4 flex-shrink-0" />}
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

function groupBy(items: CommandPaletteItem[]): { group: string; items: CommandPaletteItem[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, CommandPaletteItem[]>();
  for (const item of items) {
    if (!byGroup.has(item.group)) {
      byGroup.set(item.group, []);
      order.push(item.group);
    }
    byGroup.get(item.group)!.push(item);
  }
  return order.map((group) => ({ group, items: byGroup.get(group)! }));
}
