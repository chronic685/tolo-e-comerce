import { Link } from "react-router-dom";
import type { ReactNode } from "react";

export interface ScrollRowProps {
  title: string;
  seeAllTo?: string;
  children: ReactNode;
}

/** Horizontally-scrolling row (featured products, shops) with a title and
 * optional "See all" link. */
export function ScrollRow({ title, seeAllTo, children }: ScrollRowProps) {
  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-base">{title}</h2>
        {seeAllTo && (
          <Link to={seeAllTo} className="text-xs text-navy font-medium hover:underline">
            See all
          </Link>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 snap-x snap-mandatory">{children}</div>
    </section>
  );
}
