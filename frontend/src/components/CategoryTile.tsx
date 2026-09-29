import { LazyImage } from "@tolo/ui";

export interface CategoryTileProps {
  name: string;
  imageUrl: string | null;
  active?: boolean;
  onClick: () => void;
}

export function CategoryTile({ name, imageUrl, active, onClick }: CategoryTileProps) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 flex-shrink-0 w-20 text-center">
      <LazyImage
        src={imageUrl}
        alt={name}
        aspect="aspect-square"
        className={`w-16 h-16 rounded-full ${active ? "ring-2 ring-navy" : ""}`}
      />
      <span className={`text-xs leading-tight ${active ? "text-navy font-semibold" : "text-gray-600"}`}>{name}</span>
    </button>
  );
}
