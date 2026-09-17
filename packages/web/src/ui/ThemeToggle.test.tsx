import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { applyTheme, savedTheme, THEME_KEY, ThemeToggle } from "./ThemeToggle";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

/** A Storage whose every call throws, as in a browser with site data blocked. */
const blocked = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

it("follows the system until a theme is picked", () => {
  expect(savedTheme()).toBe("system");
  localStorage.setItem(THEME_KEY, "sepia");
  expect(savedTheme()).toBe("system");
  localStorage.setItem(THEME_KEY, "dark");
  expect(savedTheme()).toBe("dark");
});

it("saves a pick and sets it on <html>; System clears both", () => {
  applyTheme("light");
  expect(localStorage.getItem(THEME_KEY)).toBe("light");
  expect(document.documentElement.dataset.theme).toBe("light");
  applyTheme("system");
  expect(localStorage.getItem(THEME_KEY)).toBeNull();
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
});

it("still switches the page when storage throws", () => {
  expect(savedTheme(blocked)).toBe("system");
  applyTheme("dark", document.documentElement, blocked);
  expect(document.documentElement.dataset.theme).toBe("dark");
});

it("shows the saved pick as pressed and switches on click", () => {
  localStorage.setItem(THEME_KEY, "dark");
  render(<ThemeToggle />);
  const pressed = () =>
    screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true");
  expect(pressed().map((button) => button.textContent)).toEqual(["Dark"]);
  fireEvent.click(screen.getByRole("button", { name: "System" }));
  expect(pressed().map((button) => button.textContent)).toEqual(["System"]);
  expect(localStorage.getItem(THEME_KEY)).toBeNull();
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
});
