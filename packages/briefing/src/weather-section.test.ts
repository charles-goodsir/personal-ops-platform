import { expect, test, vi } from "vitest";
import { describeWeather, weatherSection } from "./weather-section.js";

const forecast = {
  daily: {
    weather_code: [80],
    temperature_2m_max: [20.0],
    temperature_2m_min: [14.9],
    precipitation_probability_max: [100],
    wind_speed_10m_max: [14.1],
  },
};
const section = (res: Response) => {
  const fetchFn = vi.fn<typeof fetch>(async () => res);
  return { fetchFn, s: weatherSection({ lat: -36.97, lon: 174.82, fetchFn }) };
};

test("summarises today's forecast in one line", async () => {
  const { s } = section(Response.json(forecast));
  expect(await s.build()).toBe(
    "Weather\nShowers, 15 to 20C, rain chance 100%, wind up to 14 km/h",
  );
});

test("sends only the coordinates, with a timeout", async () => {
  const { s, fetchFn } = section(Response.json(forecast));
  await s.build();
  const [url, init] = fetchFn.mock.calls[0] as [URL, RequestInit];
  expect(url.origin).toBe("https://api.open-meteo.com");
  expect(url.searchParams.get("latitude")).toBe("-36.97");
  expect(url.searchParams.get("longitude")).toBe("174.82");
  expect([...url.searchParams.keys()].sort()).toEqual([
    "daily",
    "forecast_days",
    "latitude",
    "longitude",
    "timezone",
  ]);
  expect(init.signal).toBeInstanceOf(AbortSignal);
});

test("a failed or malformed answer throws, so the runner skips the section", async () => {
  await expect(
    section(new Response("nope", { status: 503 })).s.build(),
  ).rejects.toThrow(/503/);
  await expect(
    section(Response.json({ daily: {} })).s.build(),
  ).rejects.toThrow();
});

test("rejects coordinates that can't exist", () => {
  expect(() => weatherSection({ lat: 91, lon: 0 })).toThrow(/out of range/);
  expect(() => weatherSection({ lat: 0, lon: 181 })).toThrow(/out of range/);
});

test("weather codes map to words", () => {
  expect([0, 2, 3, 45, 53, 63, 73, 81, 85, 95].map(describeWeather)).toEqual([
    "Clear",
    "Mostly clear",
    "Overcast",
    "Fog",
    "Drizzle",
    "Rain",
    "Snow",
    "Showers",
    "Snow showers",
    "Thunderstorms",
  ]);
});
