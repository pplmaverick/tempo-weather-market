import axios from "axios";
import { withRetry } from "../utils.js";

const OW_API_KEY = process.env.OPENWEATHER_API_KEY!;
const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY!;
const OW_BASE = "https://api.openweathermap.org";

// OpenWeather city ID 對應表（比 q=city_name 更可靠，避免同名城市歧義）
const CITY_IDS: Record<string, number> = {
  Taipei: 1668341,
  Tokyo: 1850147,
  "New York": 5128581,
  Seoul: 1835848,
};

// Open-Meteo 座標對應表（不需要 API key）
const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  Taipei:     { lat: 25.0330,  lon: 121.5654 },
  Tokyo:      { lat: 35.6762,  lon: 139.6503 },
  "New York": { lat: 40.7128,  lon: -74.0060 },
  Seoul:      { lat: 37.5665,  lon: 126.9780 },
};

interface OWCurrentResponse {
  main: { temp: number; humidity: number };
  wind: { speed: number };
  weather: { description: string }[];
  rain?: { "1h"?: number };
  dt: number;
  name: string;
}

interface WeatherAPIResponse {
  current: { temp_c: number };
}

interface OpenMeteoResponse {
  current: { temperature_2m: number };
}

export interface CurrentWeatherData {
  city: string;
  temperature: number;   // °C median of up to 3 sources
  humidity: number;      // % (from OpenWeather)
  description: string;
  windSpeed: number;     // km/h (from OpenWeather)
  precipitation: number; // mm/h (from OpenWeather)
  sources: {
    openweather?: number;
    weatherapi?: number;
    openmeteo?: number;
    median: number;
    count: number;
  };
}

function cityParams(city: string): Record<string, string | number> {
  const id = CITY_IDS[city];
  return id !== undefined
    ? { id, appid: OW_API_KEY, units: "metric" }
    : { q: city, appid: OW_API_KEY, units: "metric" };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

async function fetchOpenWeatherCurrent(city: string): Promise<OWCurrentResponse> {
  const res = await withRetry(
    () => axios.get<OWCurrentResponse>(`${OW_BASE}/data/2.5/weather`, {
      params: cityParams(city),
    }),
    `OpenWeather current/${city}`
  );
  return res.data;
}

async function fetchWeatherAPI(city: string): Promise<number> {
  const res = await axios.get<WeatherAPIResponse>(
    "https://api.weatherapi.com/v1/current.json",
    { params: { key: WEATHERAPI_KEY, q: city, aqi: "no" }, timeout: 8000 }
  );
  return res.data.current.temp_c;
}

async function fetchOpenMeteo(city: string): Promise<number> {
  const coords = CITY_COORDS[city];
  if (!coords) throw new Error(`No Open-Meteo coords for city: ${city}`);
  const res = await axios.get<OpenMeteoResponse>(
    "https://api.open-meteo.com/v1/forecast",
    {
      params: {
        latitude: coords.lat,
        longitude: coords.lon,
        current: "temperature_2m",
      },
      timeout: 8000,
    }
  );
  return res.data.current.temperature_2m;
}

export async function getCurrentWeather(city: string): Promise<CurrentWeatherData> {
  // 並行呼叫三個來源，OW 同時取完整資料供其他欄位使用
  const [owResult, waResult, omResult] = await Promise.allSettled([
    fetchOpenWeatherCurrent(city),
    fetchWeatherAPI(city),
    fetchOpenMeteo(city),
  ]);

  const temps: number[] = [];
  const sources: CurrentWeatherData["sources"] = { median: 0, count: 0 };

  let owData: OWCurrentResponse | null = null;
  if (owResult.status === "fulfilled") {
    owData = owResult.value;
    sources.openweather = Math.round(owData.main.temp * 10) / 10;
    temps.push(owData.main.temp);
  } else {
    console.warn(`[weather] OpenWeather failed for ${city}:`, owResult.reason?.message);
  }

  if (waResult.status === "fulfilled") {
    sources.weatherapi = Math.round(waResult.value * 10) / 10;
    temps.push(waResult.value);
  } else {
    console.warn(`[weather] WeatherAPI failed for ${city}:`, waResult.reason?.message);
  }

  if (omResult.status === "fulfilled") {
    sources.openmeteo = Math.round(omResult.value * 10) / 10;
    temps.push(omResult.value);
  } else {
    console.warn(`[weather] Open-Meteo failed for ${city}:`, omResult.reason?.message);
  }

  if (temps.length === 0) throw new Error(`All weather sources failed for ${city}`);

  const med = Math.round(median(temps) * 10) / 10;
  sources.median = med;
  sources.count = temps.length;

  console.log(
    `[weather] ${city} temps — OW: ${sources.openweather ?? "ERR"} | WA: ${sources.weatherapi ?? "ERR"} | OM: ${sources.openmeteo ?? "ERR"} → median: ${med}°C (${temps.length}/3 sources)`
  );

  return {
    city,
    temperature: med,
    humidity:      owData?.main.humidity ?? 0,
    description:   owData?.weather[0]?.description ?? "",
    windSpeed:     owData ? Math.round(owData.wind.speed * 3.6 * 10) / 10 : 0,
    precipitation: owData?.rain?.["1h"] ?? 0,
    sources,
  };
}

interface OWForecastItem {
  dt: number;
  main: { temp: number; temp_max: number };
}

// 三源即時溫度取中位數
async function fetchCurrentTemp(city: string): Promise<number> {
  const [owResult, waResult, omResult] = await Promise.allSettled([
    fetchOpenWeatherCurrent(city).then((d) => d.main.temp),
    fetchWeatherAPI(city),
    fetchOpenMeteo(city),
  ]);

  const temps: number[] = [];
  if (owResult.status === "fulfilled") temps.push(owResult.value);
  if (waResult.status === "fulfilled") temps.push(waResult.value);
  if (omResult.status === "fulfilled") temps.push(omResult.value);

  if (temps.length === 0) throw new Error(`All weather sources failed for ${city}`);

  const med = median(temps);
  console.log(`[weather] fetchCurrentTemp ${city}: ${temps.map((t) => t.toFixed(1)).join(", ")} → median ${med.toFixed(1)}°C`);
  return med;
}

async function fetchForecastMaxTemp(city: string, targetDate: Date): Promise<number> {
  const res = await withRetry(
    () => axios.get<{ list: OWForecastItem[] }>(`${OW_BASE}/data/2.5/forecast`, {
      params: { ...cityParams(city), cnt: 40 },
    }),
    `OpenWeather forecast/${city}`
  );

  const targetDay = targetDate.toISOString().slice(0, 10);

  const dayItems = res.data.list.filter((item) => {
    const d = new Date(item.dt * 1000).toISOString().slice(0, 10);
    return d === targetDay;
  });

  if (dayItems.length === 0) {
    const nearest = res.data.list.reduce((prev, curr) =>
      Math.abs(curr.dt * 1000 - targetDate.getTime()) <
      Math.abs(prev.dt * 1000 - targetDate.getTime())
        ? curr
        : prev
    );
    return nearest.main.temp_max;
  }

  return Math.max(...dayItems.map((i) => i.main.temp_max));
}

// 取得指定城市在 targetDate 的最高氣溫（°C × 10）
// 合約慣例：finalTemp = °C × 10，e.g. 315 = 31.5°C
export async function getMaxTemp(city: string, targetDate: Date): Promise<number> {
  const nowMs = Date.now();
  const targetMs = targetDate.getTime();
  const diffDays = (targetMs - nowMs) / 86_400_000;

  let tempC: number;

  if (Math.abs(diffDays) < 0.5) {
    tempC = await fetchCurrentTemp(city);
  } else if (diffDays > 0 && diffDays <= 5) {
    tempC = await fetchForecastMaxTemp(city, targetDate);
  } else if (diffDays < 0) {
    console.warn(`[weather] ${city} targetDate 已過去，使用即時氣溫代替`);
    tempC = await fetchCurrentTemp(city);
  } else {
    console.warn(`[weather] ${city} targetDate 超過 5 天，使用即時氣溫代替`);
    tempC = await fetchCurrentTemp(city);
  }

  return Math.round(tempC * 10);
}
