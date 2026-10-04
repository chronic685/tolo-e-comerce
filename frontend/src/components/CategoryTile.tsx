import { CategoryIcon } from "@tolo/ui";

export interface CategoryTileProps {
  name: string;
  icon: string;
  color: string;
  active?: boolean;
  onClick: () => void;
}

export function CategoryTile({ name, icon, color, active, onClick }: CategoryTileProps) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 flex-shrink-0 w-20 text-center">
      <CategoryIcon icon={icon} color={color} size="lg" className={active ? "ring-2 ring-navy dark:ring-navy-light" : ""} />
      <span className={`text-xs leading-tight ${active ? "text-navy dark:text-white font-semibold" : "text-gray-600 dark:text-gray-300"}`}>{name}</span>
    </button>
  );
}
