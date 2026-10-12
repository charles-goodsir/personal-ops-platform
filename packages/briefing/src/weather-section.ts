import { z } from "zod";
import type { Section } from "./runner.js";

// Open-Meteo's daily forecast for one point. Free, no key, and the only thing
// sent is the coordinates.
const Forecast = z.object({
  daily: z.object({
    weather_code: z.tuple([z.number()]),
    temperature_2m_max: z.tuple([z.number()]),
    temperature_2m_min: z.tuple([z.number()]),
    precipitation_probability_max: z.tuple([z.number()]),
    wind_speed_10m_max: z.tuple([z.number()]),
  }),
});

// WMO weather codes, grouped the way Open-Meteo documents them.
export function describeWeather(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Mostly clear";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorms";
}

export function weatherSection(opts: {
  lat: number;
  lon: number;
  fetchFn?: typeof fetch;
  retryDelayMs?: number;
}): Section {
  if (Math.abs(opts.lat) > 90 || Math.abs(opts.lon) > 180)
    throw new Error("weather coordinates are out of range");
  const doFetch = opts.fetchFn ?? fetch;
  return {
    name: "Weather",
    async build() {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.search = new URLSearchParams({
        latitude: String(opts.lat),
        longitude: String(opts.lon),
        daily:
          "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max",
        timezone: "Pacific/Auckland",
        forecast_days: "1",
      }).toString();
      // Open-Meteo answers 503 now and then, so try three times before the
      // section is skipped.
      let res: Response | undefined;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (attempt > 1)
          await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 5_000));
        try {
          res = await doFetch(url, { signal: AbortSignal.timeout(10_000) });
          if (res.ok) break;
        } catch (err) {
          if (attempt === 3) throw err;
        }
      }
      if (!res?.ok) throw new Error(`open-meteo answered ${res?.status}`);
      const { daily: d } = Forecast.parse(await res.json());
      return [
        "Weather",
        `${describeWeather(d.weather_code[0])}, ${Math.round(d.temperature_2m_min[0])} to ${Math.round(d.temperature_2m_max[0])}C, rain chance ${Math.round(d.precipitation_probability_max[0])}%, wind up to ${Math.round(d.wind_speed_10m_max[0])} km/h`,
      ].join("\n");
    },
  };
}
