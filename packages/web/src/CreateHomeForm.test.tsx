import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Home } from "./api";
import { CreateHomeForm } from "./CreateHomeForm";
import { inputsTo, renderRoutes, stubApi } from "./testSupport";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const formRoutes = [
  { path: "/", element: <CreateHomeForm /> },
  { path: "/homes/:slug", element: <p>Home page</p> },
];

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

it("asks for the latitude when the server does not know the city, and sends it", async () => {
  const cabin: Home = {
    slug: "cabin",
    name: "Cabin",
    country: "Norway",
    city: "Nowhere",
    latitude: 69.1,
  };
  const fetch = stubApi({
    create_home: (input) =>
      input.latitude === undefined
        ? Response.json(
            {
              error: {
                code: "city_not_found",
                message: "No city Nowhere in Norway. Give the latitude.",
              },
            },
            { status: 400 },
          )
        : { home: cabin },
  });
  const { router } = renderRoutes("/", formRoutes);
  expect(screen.queryByLabelText("Latitude")).toBeNull();

  fill("Name", "Cabin");
  fill("Country", "Norway");
  fill("City", "Nowhere");
  fireEvent.click(screen.getByRole("button", { name: "Create Home" }));

  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "No city Nowhere in Norway. Give the latitude.",
  );
  fill("Latitude", "69.1");
  fireEvent.click(screen.getByRole("button", { name: "Create Home" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/homes/cabin"));
  expect(inputsTo(fetch, "create_home")).toEqual([
    { name: "Cabin", country: "Norway", city: "Nowhere" },
    { name: "Cabin", country: "Norway", city: "Nowhere", latitude: 69.1 },
  ]);
});

it("does not ask for the latitude when the server refuses for another reason", async () => {
  stubApi({
    create_home: () =>
      Response.json({ error: { code: "validation", message: "Name is empty." } }, { status: 400 }),
  });
  renderRoutes("/", formRoutes);
  fill("Name", " ");
  fill("Country", "Spain");
  fill("City", "Madrid");
  fireEvent.click(screen.getByRole("button", { name: "Create Home" }));
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Latitude")).toBeNull();
});
