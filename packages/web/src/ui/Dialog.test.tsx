import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { Dialog } from "./Dialog";

afterEach(cleanup);

function Page({ navInert = false }: { navInert?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <nav inert={navInert}>
        <a href="/rooms">Rooms</a>
      </nav>
      <main>
        <button type="button">Behind</button>
        {open ? (
          <Dialog label="Delete your account" onClose={() => setOpen(false)}>
            <label>
              Your email
              <input type="text" />
            </label>
            <button type="button">Cancel</button>
          </Dialog>
        ) : (
          <p>Closed</p>
        )}
      </main>
    </div>
  );
}

function backdrop(): HTMLElement {
  const panel = screen.getByRole("dialog", { name: "Delete your account" });
  return panel.parentElement as HTMLElement;
}

it("makes the page behind inert while it is open, and gives it back on closing", () => {
  render(<Page />);
  const behind = screen.getByText("Behind");
  const nav = screen.getByText("Rooms").closest("nav") as HTMLElement;
  expect(behind.hasAttribute("inert")).toBe(true);
  expect(nav.hasAttribute("inert")).toBe(true);
  expect(backdrop().closest("[inert]")).toBeNull();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.getByText("Closed")).toBeTruthy();
  expect(behind.hasAttribute("inert")).toBe(false);
  expect(nav.hasAttribute("inert")).toBe(false);
});

it("leaves alone a part of the page that was already inert", () => {
  render(<Page navInert />);
  const nav = screen.getByText("Rooms").closest("nav") as HTMLElement;
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.getByText("Closed")).toBeTruthy();
  expect(nav.hasAttribute("inert")).toBe(true);
});

it("closes on a click on the backdrop that started there", () => {
  render(<Page />);
  const outside = backdrop();
  fireEvent.pointerDown(outside);
  fireEvent.click(outside);
  expect(screen.getByText("Closed")).toBeTruthy();
});

it("stays open when a drag starts in the box and ends on the backdrop", () => {
  render(<Page />);
  const field = screen.getByRole("textbox", { name: "Your email" });
  const outside = backdrop();
  fireEvent.pointerDown(field);
  fireEvent.click(outside);
  expect(screen.queryByText("Closed")).toBeNull();
});

it("keeps what is typed when Escape is pressed in a field that holds text", () => {
  render(<Page />);
  const field = screen.getByRole("textbox", { name: "Your email" });
  fireEvent.change(field, { target: { value: "me@example.com" } });
  fireEvent.keyDown(field, { key: "Escape" });
  expect(screen.queryByText("Closed")).toBeNull();
  // From an empty field, or anywhere else, Escape closes it.
  fireEvent.change(field, { target: { value: "" } });
  fireEvent.keyDown(field, { key: "Escape" });
  expect(screen.getByText("Closed")).toBeTruthy();
});

function Caption() {
  const [open, setOpen] = useState(true);
  const [caption, setCaption] = useState("The oak table by the window");
  return open ? (
    <Dialog label="Photo" onClose={() => setOpen(false)}>
      <label>
        Caption
        <input type="text" value={caption} onChange={(event) => setCaption(event.target.value)} />
      </label>
    </Dialog>
  ) : (
    <p>Closed</p>
  );
}

it("closes on Escape from a field that holds only its saved text", () => {
  render(<Caption />);
  const field = screen.getByRole("textbox", { name: "Caption" });
  fireEvent.focus(field);
  fireEvent.keyDown(field, { key: "Escape" });
  expect(screen.getByText("Closed")).toBeTruthy();
});

it("keeps an edit to saved text when Escape is pressed in its field", () => {
  render(<Caption />);
  const field = screen.getByRole("textbox", { name: "Caption" });
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "The oak table" } });
  fireEvent.keyDown(field, { key: "Escape" });
  expect(screen.queryByText("Closed")).toBeNull();
});
