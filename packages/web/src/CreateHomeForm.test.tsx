import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Home } from "./api";
import { CreateHomeForm } from "./CreateHomeForm";
import { inputsTo, renderRoutes, stubApi } from "./testSupport";

// The browser's time zone, which the form sends for the Home's days.
const machineZone = process.env.TZ;
beforeEach(() => {
  process.env.TZ = "America/Lima";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  process.env.TZ = machineZone;
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
    { name: "Cabin", country: "Norway", city: "Nowhere", timeZone: "America/Lima" },
    {
      name: "Cabin",
      country: "Norway",
      city: "Nowhere",
      timeZone: "America/Lima",
      latitude: 69.1,
    },
  ]);
});

it("drops the latitude it asked for when the city is corrected, and looks the new one up", async () => {
  const flat: Home = {
    slug: "flat",
    name: "Flat",
    country: "Portugal",
    city: "Lisbon",
    latitude: 38.7,
  };
  const fetch = stubApi({
    create_home: (input) =>
      input.city === "Lisbn"
        ? Response.json(
            { error: { code: "city_not_found", message: "No city Lisbn in Portugal." } },
            { status: 400 },
          )
        : { home: flat },
  });
  const { router } = renderRoutes("/", formRoutes);

  fill("Name", "Flat");
  fill("Country", "Portugal");
  fill("City", "Lisbn");
  fireEvent.click(screen.getByRole("button", { name: "Create Home" }));
  await screen.findByLabelText("Latitude");

  fill("City", "Lisbon");
  expect(screen.queryByLabelText("Latitude")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Create Home" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/homes/flat"));
  expect(inputsTo(fetch, "create_home")).toEqual([
    { name: "Flat", country: "Portugal", city: "Lisbn", timeZone: "America/Lima" },
    { name: "Flat", country: "Portugal", city: "Lisbon", timeZone: "America/Lima" },
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

it("sends the browser's time zone, the zone the Home's days are dated in", async () => {
  const fetch = stubApi({
    create_home: () => ({
      home: { slug: "flat", name: "Flat", country: "PE", city: "Lima", latitude: -12 },
    }),
  });
  renderRoutes("/", formRoutes);
  fill("Name", "Flat");
  fill("Country", "PE");
  fill("City", "Lima");
  fireEvent.click(screen.getByRole("button", { name: "Create Home" }));
  await waitFor(() => expect(inputsTo(fetch, "create_home")).toHaveLength(1));
  expect(inputsTo(fetch, "create_home")[0]).toMatchObject({ timeZone: "America/Lima" });
});
