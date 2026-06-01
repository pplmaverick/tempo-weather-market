import axios from "axios";
import { withRetry } from "../utils.js";

const API_KEY = process.env.OPENWEATHER_API_KEY!;
const BASE = "https://api.openweathermap.org";

// OpenWeather city ID 對應表（比 q=city_name 更可靠，避免同名城市歧義）
const CITY_IDS: Record<string, number> = {
  Taipei: 1668341,
  Tokyo: 1850147,
  "New York": 5128581,
  Seoul: 1835848,
};

interface OWCurrentResponse {
  main: { temp: number; humidity: number };
  wind: { speed: number };
  weather: { description: string }[];
  rain?: { "1h"?: number };
  dt: number;
  name: string;
}

export interface CurrentWeatherData {
  city: string;
  temperature: number;   // °C (not x10)
  humidity: number;      // %
  description: string;
  windSpeed: number;     // km/h
  precipitation: number; // mm/h (0 if none)
}

export async function getCurrentWeather(city: string): Promise<CurrentWeatherData> {
  const res = await withRetry(
    () => axios.get<OWCurrentResponse>(`${BASE}/data/2.5/weather`, {
      params: cityParams(city),
    }),
    `OpenWeather current/${city}`
  );
  const d = res.data;
  return {
    city,
    temperature: Math.round(d.main.temp * 10) / 10,
    humidity: d.main.humidity,
    description: d.weather[0]?.description ?? "",
    windSpeed: Math.round(d.wind.speed * 3.6 * 10) / 10, // m/s → km/h
    precipitation: d.rain?.["1h"] ?? 0,
  };
}

interface OWForecastItem {
  dt: number;
  main: { temp: number; temp_max: number };
}

function cityParams(city: string): Record<string, string | number> {
  const id = CITY_IDS[city];
  return id !== undefined
    ? { id, appid: API_KEY, units: "metric" }
    : { q: city, appid: API_KEY, units: "metric" };
}

// 取得指定城市在 targetDate 的最高氣溫（°C × 10）
// 合約慣例：finalTemp = °C × 10，e.g. 315 = 31.5°C
// buckets 建立時也應使用相同單位
export async function getMaxTemp(city: string, targetDate: Date): Promise<number> {
  const nowMs = Date.now();
  const targetMs = targetDate.getTime();
  const diffDays = (targetMs - nowMs) / 86_400_000;

  let tempC: number;

  if (Math.abs(diffDays) < 0.5) {
    // 當天：用即時天氣
    tempC = await fetchCurrentTemp(city);
  } else if (diffDays > 0 && diffDays <= 5) {
    // 未來 5 天：用免費 forecast API
    tempC = await fetchForecastMaxTemp(city, targetDate);
  } else if (diffDays < 0) {
    // 過去：需要 One Call API 3.0（付費），fallback 用即時
    console.warn(`[weather] ${city} targetDate 已過去，使用即時氣溫代替`);
    tempC = await fetchCurrentTemp(city);
  } else {
    // 超過 5 天後：forecast 不支援，用即時
    console.warn(`[weather] ${city} targetDate 超過 5 天，使用即時氣溫代替`);
    tempC = await fetchCurrentTemp(city);
  }

  // °C × 10，四捨五入到整數
  return Math.round(tempC * 10);
}

async function fetchCurrentTemp(city: string): Promise<number> {
  const res = await withRetry(
    () => axios.get<OWCurrentResponse>(`${BASE}/data/2.5/weather`, {
      params: cityParams(city),
    }),
    `OpenWeather current/${city}`
  );
  return res.data.main.temp;
}

async function fetchForecastMaxTemp(city: string, targetDate: Date): Promise<number> {
  const res = await withRetry(
    () => axios.get<{ list: OWForecastItem[] }>(`${BASE}/data/2.5/forecast`, {
      params: { ...cityParams(city), cnt: 40 },
    }),
    `OpenWeather forecast/${city}`
  );

  const targetDay = targetDate.toISOString().slice(0, 10);

  // 找出 targetDate 當天所有預報，取最高溫
  const dayItems = res.data.list.filter((item) => {
    const d = new Date(item.dt * 1000).toISOString().slice(0, 10);
    return d === targetDay;
  });

  if (dayItems.length === 0) {
    // 無該日預報，取最近一筆
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
