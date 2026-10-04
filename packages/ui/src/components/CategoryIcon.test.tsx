import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { localizedName } from "../i18n/categoryName";
import { CATEGORY_COLORS, CATEGORY_ICON_NAMES, CategoryIcon } from "./CategoryIcon";

describe("CategoryIcon", () => {
  it("renders an svg tinted with the category's color, with light and dark styles", () => {
    const { container } = render(<CategoryIcon icon="shirt" color="rose" />);
    const badge = container.firstElementChild!;
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(badge.className).toContain("bg-rose-100");
    expect(badge.className).toContain("dark:bg-rose-500/20");
    expect(badge.getAttribute("aria-hidden")).toBe("true");
  });

  it("falls back to a generic icon and the brand color for unknown names", () => {
    const { container } = render(<CategoryIcon icon="no-such-icon" color="hotpink" />);
    const badge = container.firstElementChild!;
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(badge.className).toContain("bg-navy-50");
    render(<CategoryIcon />);
  });

  it("offers every icon and color an admin can pick, and each one renders", () => {
    expect(CATEGORY_ICON_NAMES).toEqual(expect.arrayContaining(["shirt", "shopping-basket", "sparkles", "sofa", "smartphone"]));
    for (const icon of CATEGORY_ICON_NAMES) {
      const { container } = render(<CategoryIcon icon={icon} />);
      expect(container.querySelector("svg")).not.toBeNull();
    }
    for (const color of CATEGORY_COLORS) {
      const { container } = render(<CategoryIcon color={color} />);
      expect(container.firstElementChild!.className).toContain("dark:");
    }
  });
});

describe("localizedName", () => {
  const fashion = { name: "Fashion", name_am: "ፋሽን" };

  it("uses the Amharic name in Amharic and the English name otherwise", () => {
    expect(localizedName(fashion, "am")).toBe("ፋሽን");
    expect(localizedName(fashion, "en")).toBe("Fashion");
  });

  it("falls back to the English name when there is no Amharic one", () => {
    expect(localizedName({ name: "Toys", name_am: null }, "am")).toBe("Toys");
    expect(localizedName({ name: "Toys", name_am: "  " }, "am")).toBe("Toys");
    expect(localizedName({ name: "Toys" }, "am")).toBe("Toys");
  });
});
