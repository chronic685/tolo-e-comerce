import {
  Apple,
  Baby,
  BookOpen,
  Car,
  Dumbbell,
  Flower2,
  Gamepad2,
  Gem,
  Gift,
  Home,
  Laptop,
  PawPrint,
  Plug,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Sofa,
  Sparkles,
  Tag,
  Utensils,
  Watch,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";

/** The icons an admin can give a category, keyed by the name stored in
 * categories.icon. One set (lucide, already used across the apps) so every
 * category looks like it belongs to the same family. */
const ICONS: Record<string, LucideIcon> = {
  shirt: Shirt,
  "shopping-basket": ShoppingBasket,
  sparkles: Sparkles,
  sofa: Sofa,
  smartphone: Smartphone,
  plug: Plug,
  laptop: Laptop,
  watch: Watch,
  gem: Gem,
  gift: Gift,
  baby: Baby,
  utensils: Utensils,
  apple: Apple,
  dumbbell: Dumbbell,
  car: Car,
  "book-open": BookOpen,
  "paw-print": PawPrint,
  flower: Flower2,
  gamepad: Gamepad2,
  wrench: Wrench,
  home: Home,
  tag: Tag,
};

export const CATEGORY_ICON_NAMES = Object.keys(ICONS);

/** The palette an admin picks a category color from: a soft tint with a deeper
 * foreground in light mode, a translucent tint with a lighter foreground in dark
 * mode. Class names are spelled out in full so Tailwind sees them. */
const COLORS = {
  navy: "bg-navy-50 text-navy dark:bg-navy-light/30 dark:text-blue-200",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
} as const;

export type CategoryColor = keyof typeof COLORS;
export const CATEGORY_COLORS = Object.keys(COLORS) as CategoryColor[];

const SIZES = {
  xs: { box: "w-5 h-5", icon: "w-3 h-3" },
  sm: { box: "w-7 h-7", icon: "w-4 h-4" },
  lg: { box: "w-16 h-16", icon: "w-7 h-7" },
} as const;

export interface CategoryIconProps {
  icon?: string | null;
  color?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}

/** A category's round icon badge. Unknown icon or color names (a typo in the
 * data, or one added by a newer admin than this build) fall back to the generic
 * tag and the brand color rather than rendering nothing. Decorative: the
 * category name next to it is what screen readers get. */
export function CategoryIcon({ icon, color, size = "sm", className }: CategoryIconProps) {
  const Icon = (icon && ICONS[icon]) || Tag;
  const palette = (color && COLORS[color as CategoryColor]) || COLORS.navy;
  const { box, icon: iconSize } = SIZES[size];
  return (
    <span aria-hidden="true" className={cn("inline-flex items-center justify-center rounded-full flex-shrink-0", box, palette, className)}>
      <Icon className={iconSize} />
    </span>
  );
}
