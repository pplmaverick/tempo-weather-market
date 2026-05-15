import axios from "axios";

const API_KEY = process.env.OPENWEATHER_API_KEY!;
const BASE = "https://api.openweathermap.org";

interface OWCurrentResponse {
  main: { temp: number };
  dt: number;
  name: string;
}

interface OWForecastItem {
  dt: number;
  main: { temp: number; temp_max: number };
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
  const res = await axios.get<OWCurrentResponse>(
    `${BASE}/data/2.5/weather`,
    { params: { q: city, appid: API_KEY, units: "metric" } }
  );
  return res.data.main.temp;
}

async function fetchForecastMaxTemp(city: string, targetDate: Date): Promise<number> {
  const res = await axios.get<{ list: OWForecastItem[] }>(
    `${BASE}/data/2.5/forecast`,
    { params: { q: city, appid: API_KEY, units: "metric", cnt: 40 } }
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
