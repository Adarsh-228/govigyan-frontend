"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type LoginPayload = {
  email: string;
  password: string;
};

type InventorySummary = {
  total_items?: number;
  low_stock_count?: number;
  critical_stock_count?: number;
  [key: string]: unknown;
};

type StockTrendPoint = {
  date: string;
  net_change: number;
};

type FeedBurnRateSummary = {
  range?: string;
  total_feed_consumed?: number;
  daily_burn_rate?: number;
};

type InventoryAlert = {
  id: string;
  alert_type: string;
  message: string;
  is_read: boolean;
};

type CategoryShare = {
  label: string;
  value: number;
};

type InventoryItem = {
  id?: string;
  name?: string;
  sku?: string;
  category?: string;
  status?: string;
  item_type?: string;
  unit?: string;
  is_active?: boolean;
  quantity?: number;
  [key: string]: unknown;
};

type ItemPayload = {
  name: string;
  sku: string;
  category: string;
  item_type: string;
  unit: string;
  description: string;
  is_active: boolean;
};

type StockFormPayload = {
  item_id: string;
  department_id: string;
  quantity: string;
  notes: string;
  unit_cost: string;
};

type DepartmentOption = {
  id: string;
  name: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "https://govigyan-backend.onrender.com";

function readToken(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const direct =
    record.access_token ?? record.token ?? record.jwt ?? record.auth_token;
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }

  const nestedData = record.data;
  if (nestedData && typeof nestedData === "object") {
    const nested = nestedData as Record<string, unknown>;
    const nestedToken = nested.access_token ?? nested.token;
    if (typeof nestedToken === "string" && nestedToken.length > 0) {
      return nestedToken;
    }
  }

  return null;
}

function toRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  return data as Record<string, unknown>;
}

function toArray(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }

  const record = toRecord(data);
  if (!record) {
    return [];
  }

  const candidates = [record.data, record.items, record.results, record.rows];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

/** Normalizes list endpoints that may return an array, { data: [] }, or a single row object. */
function extractRowList(
  data: unknown,
  rowFieldHints: string[],
): { rows: unknown[]; mode: "array" | "nested" | "single" | "empty" } {
  if (Array.isArray(data)) {
    return { rows: data, mode: data.length ? "array" : "empty" };
  }

  const record = toRecord(data);
  if (!record) {
    return { rows: [], mode: "empty" };
  }

  const nestedKeys = ["data", "items", "results", "rows", "stock", "stocks"] as const;
  for (const key of nestedKeys) {
    const val = record[key];
    if (Array.isArray(val)) {
      return { rows: val, mode: "nested" };
    }
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const inner = toRecord(val);
      if (inner && rowFieldHints.some((h) => inner[h] !== undefined)) {
        return { rows: [inner], mode: "single" };
      }
    }
  }

  if (rowFieldHints.some((h) => record[h] !== undefined)) {
    return { rows: [record], mode: "single" };
  }

  return { rows: [], mode: "empty" };
}

function readNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return 0;
}

/** Browser throws this when the request is blocked or never reaches the server (CORS, offline, bad URL, etc.). */
function describeFetchError(error: unknown): string {
  if (error instanceof TypeError && error.message === "Failed to fetch") {
    return (
      "Could not reach the API (Failed to fetch). Usually: CORS — the backend must allow your frontend origin " +
      "(e.g. http://localhost:3000); or wrong NEXT_PUBLIC_API_BASE; or network/offline. " +
      `Trying: ${API_BASE}`
    );
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed.";
}

const selectFieldClass =
  "w-full border border-line bg-white px-3 py-2 text-sm text-foreground";

function parseDepartmentOptions(data: unknown): DepartmentOption[] {
  const { rows } = extractRowList(data, ["id", "name"]);
  const out: DepartmentOption[] = [];
  for (const row of rows) {
    const rec = toRecord(row);
    if (!rec) {
      continue;
    }
    const idRaw = rec.id;
    if (idRaw === undefined || idRaw === null) {
      continue;
    }
    const id = typeof idRaw === "string" ? idRaw : String(idRaw);
    const name = rec.name;
    out.push({
      id,
      name: typeof name === "string" && name.trim() ? name.trim() : id,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function itemOptionLabel(item: InventoryItem): string {
  const name = item.name?.trim() || "Unnamed item";
  const sku = item.sku?.trim();
  return sku ? `${name} · ${sku}` : name;
}

function cleanItemPayload(form: ItemPayload): Record<string, unknown> {
  return {
    name: form.name,
    sku: form.sku.trim() || null,
    category: form.category.trim() || null,
    item_type: form.item_type.trim() || "general",
    unit: form.unit.trim() || "unit",
    description: form.description.trim() || null,
    is_active: form.is_active,
  };
}

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem("govigyan_token");
  });
  const [userName, setUserName] = useState("User");
  const [activeView, setActiveView] = useState<"dashboard" | "erp">("dashboard");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [stockTrend, setStockTrend] = useState<StockTrendPoint[]>([]);
  const [feedBurnRate, setFeedBurnRate] = useState<FeedBurnRateSummary | null>(null);
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
  const [alertsMeta, setAlertsMeta] = useState<{
    count: number;
    unread_count: number;
  } | null>(null);
  const [categoryDistribution, setCategoryDistribution] = useState<CategoryShare[]>(
    [],
  );
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [itemsListCount, setItemsListCount] = useState<number | null>(null);
  const [dashboardRange, setDashboardRange] = useState<"7d" | "30d" | "90d">("30d");
  const [erpMessage, setErpMessage] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selectedItem, setSelectedItem] = useState<Record<string, unknown> | null>(
    null,
  );
  const [stockLookupDepartmentId, setStockLookupDepartmentId] = useState("");
  const [departmentStockRows, setDepartmentStockRows] = useState<unknown[]>([]);
  /** Last successful API body (so we can show JSON when row shape differs). */
  const [departmentStockRaw, setDepartmentStockRaw] = useState<unknown | null>(null);
  const [createItemForm, setCreateItemForm] = useState<ItemPayload>({
    name: "",
    sku: "",
    category: "",
    item_type: "feed",
    unit: "kg",
    description: "",
    is_active: true,
  });
  const [updateItemForm, setUpdateItemForm] = useState<ItemPayload>({
    name: "",
    sku: "",
    category: "",
    item_type: "feed",
    unit: "kg",
    description: "",
    is_active: true,
  });
  const [quantityForm, setQuantityForm] = useState({
    item_id: "",
    department_id: "",
    quantity: "",
  });
  const [thresholdForm, setThresholdForm] = useState({
    item_id: "",
    department_id: "",
    reorder_level: "",
  });
  const [stockInForm, setStockInForm] = useState<StockFormPayload>({
    item_id: "",
    department_id: "",
    quantity: "",
    notes: "",
    unit_cost: "",
  });
  const [stockOutForm, setStockOutForm] = useState<StockFormPayload>({
    item_id: "",
    department_id: "",
    quantity: "",
    notes: "",
    unit_cost: "",
  });

  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  );

  const itemsSortedForSelect = useMemo(
    () =>
      [...items]
        .filter((item) => typeof item.id === "string")
        .sort((a, b) =>
          (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
        ),
    [items],
  );

  async function fetchJson(path: string, headers: HeadersInit = {}) {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        cache: "no-store",
      });
    } catch (error) {
      throw new Error(describeFetchError(error));
    }

    if (!response.ok) {
      let detail = "";
      try {
        const errText = await response.text();
        const errJson = JSON.parse(errText);
        if (errJson?.detail) {
          detail = typeof errJson.detail === "string"
            ? errJson.detail
            : JSON.stringify(errJson.detail);
        } else {
          detail = errText;
        }
      } catch {
        /* ignore */
      }
      throw new Error(
        detail
          ? `GET ${path} failed (${response.status}): ${detail}`
          : `Request failed (${response.status})`,
      );
    }

    return response.json();
  }

  async function requestJson(
    path: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    headers: HeadersInit = {},
    body?: Record<string, unknown>,
  ) {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
    } catch (error) {
      throw new Error(describeFetchError(error));
    }

    if (!response.ok) {
      let detail = "";
      try {
        const errText = await response.text();
        const errJson = JSON.parse(errText);
        if (errJson?.detail) {
          detail = typeof errJson.detail === "string"
            ? errJson.detail
            : JSON.stringify(errJson.detail);
        } else {
          detail = errText;
        }
      } catch {
        /* ignore parse failure */
      }
      throw new Error(
        detail
          ? `${method} ${path} failed (${response.status}): ${detail}`
          : `${method} ${path} failed (${response.status})`,
      );
    }

    const text = await response.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  function parseStockTrend(response: unknown): StockTrendPoint[] {
    const record = toRecord(response);
    const points =
      record && Array.isArray(record.points) ? record.points : toArray(response);
    if (points.length === 0) {
      return [];
    }

    return points
      .map((row, index) => {
        const r = toRecord(row);
        if (!r) {
          return null;
        }
        const dateRaw = r.date ?? r.label ?? r.day ?? `day-${index + 1}`;
        const date = String(dateRaw);
        const net_change = readNumber(r, ["net_change", "value", "change"]);
        return { date, net_change };
      })
      .filter((point): point is StockTrendPoint => Boolean(point));
  }

  function parseFeedBurnRate(response: unknown): FeedBurnRateSummary | null {
    const record = toRecord(response);
    if (!record) {
      return null;
    }
    return {
      range: typeof record.range === "string" ? record.range : undefined,
      total_feed_consumed: readNumber(record, ["total_feed_consumed"]),
      daily_burn_rate: readNumber(record, ["daily_burn_rate"]),
    };
  }

  function parseAlertsResponse(response: unknown): {
    count: number;
    unread_count: number;
    alerts: InventoryAlert[];
  } {
    const record = toRecord(response);
    if (!record) {
      return { count: 0, unread_count: 0, alerts: [] };
    }
    const count = typeof record.count === "number" ? record.count : 0;
    const unread_count =
      typeof record.unread_count === "number" ? record.unread_count : 0;
    const list = Array.isArray(record.data) ? record.data : [];

    const alerts = list
      .map((row) => {
        const r = toRecord(row);
        if (!r) {
          return null;
        }
        const id = r.id;
        if (typeof id !== "string") {
          return null;
        }
        return {
          id,
          alert_type: String(r.alert_type ?? "alert"),
          message: String(r.message ?? ""),
          is_read: Boolean(r.is_read),
        };
      })
      .filter((alert): alert is InventoryAlert => alert !== null);

    return { count, unread_count, alerts };
  }

  function parseCategoryDistribution(response: unknown): CategoryShare[] {
    const record = toRecord(response);
    const rows =
      record && Array.isArray(record.data) ? record.data : toArray(response);
    if (rows.length === 0) {
      return [];
    }

    return rows
      .map((row, index) => {
        const r = toRecord(row);
        if (!r) {
          return null;
        }
        const labelCandidate =
          r.category ?? r.label ?? r.name ?? `Category ${index + 1}`;
        const value = readNumber(r, ["count", "value", "quantity", "total"]);
        return { label: String(labelCandidate), value };
      })
      .filter((entry): entry is CategoryShare => Boolean(entry));
  }

  function parseItemsListResponse(response: unknown): {
    items: InventoryItem[];
    count: number;
  } {
    if (Array.isArray(response)) {
      const list = response as InventoryItem[];
      return { items: list, count: list.length };
    }
    const record = toRecord(response);
    if (!record) {
      return { items: [], count: 0 };
    }
    const data = record.data;
    const items = Array.isArray(data) ? (data as InventoryItem[]) : [];
    const count = typeof record.count === "number" ? record.count : items.length;
    return { items, count };
  }

  function unwrapEntityPayload(data: unknown): unknown {
    const record = toRecord(data);
    if (record && "data" in record && record.data !== undefined) {
      return record.data;
    }
    return data;
  }

  async function loadDashboardData(
    currentHeaders: HeadersInit,
    range: "7d" | "30d" | "90d",
  ) {
    const [
      summaryResponse,
      stockTrendResponse,
      burnRateResponse,
      alertsResponse,
      categoryDistributionResponse,
      itemsResponse,
    ] = await Promise.all([
      fetchJson("/api/dashboard/inventory-summary", currentHeaders),
      fetchJson(`/api/dashboard/stock-trend?range=${range}`, currentHeaders),
      fetchJson(`/api/dashboard/feed-burn-rate?range=${range}`, currentHeaders),
      fetchJson("/api/dashboard/inventory-alerts?limit=50", currentHeaders),
      fetchJson("/api/dashboard/category-distribution", currentHeaders),
      fetchJson("/api/items", currentHeaders),
    ]);

    if (summaryResponse && typeof summaryResponse === "object") {
      setSummary(summaryResponse as InventorySummary);
    }

    setStockTrend(parseStockTrend(stockTrendResponse));
    setFeedBurnRate(parseFeedBurnRate(burnRateResponse));
    const parsedAlerts = parseAlertsResponse(alertsResponse);
    setAlerts(parsedAlerts.alerts);
    setAlertsMeta({ count: parsedAlerts.count, unread_count: parsedAlerts.unread_count });
    setCategoryDistribution(parseCategoryDistribution(categoryDistributionResponse));

    const { items: nextItems, count: nextCount } = parseItemsListResponse(itemsResponse);
    setItems(nextItems);
    setItemsListCount(nextCount);
  }

  async function fetchItemsList(currentHeaders: HeadersInit) {
    const itemsResponse = await fetchJson("/api/items", currentHeaders);
    return parseItemsListResponse(itemsResponse);
  }

  async function loadItems(currentHeaders: HeadersInit) {
    const { items: nextItems, count: nextCount } = await fetchItemsList(currentHeaders);
    setItems(nextItems);
    setItemsListCount(nextCount);
  }

  async function loadDepartments(currentHeaders: HeadersInit) {
    try {
      const response = await fetchJson(
        "/api/v1/inventory/departments",
        currentHeaders,
      );
      setDepartments(parseDepartmentOptions(response));
    } catch {
      setDepartments([]);
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }

    const headers = { Authorization: `Bearer ${token}` };
    void fetchJson("/api/v1/auth/me", headers)
      .then((data) => {
        if (data && typeof data === "object") {
          const record = data as Record<string, unknown>;
          const nameValue =
            record.name ?? record.full_name ?? record.email ?? record.username;
          if (typeof nameValue === "string" && nameValue.length > 0) {
            setUserName(nameValue);
          }
        }
      })
      .catch(() => {
        setUserName("User");
      });

    const timer = window.setTimeout(() => {
      void loadDashboardData(headers, dashboardRange).catch((loadError) => {
        setError(describeFetchError(loadError));
      });

      void loadDepartments(headers).catch(() => {
        setDepartments([]);
      });
    }, 0);

    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, dashboardRange]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    const payload: LoginPayload = { email, password };

    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("Invalid login credentials");
      }

      const data = await response.json();
      const nextToken = readToken(data);

      if (!nextToken) {
        throw new Error("Login succeeded but no token was returned by API");
      }

      window.localStorage.setItem("govigyan_token", nextToken);
      setToken(nextToken);
      setPassword("");
    } catch (unknownError) {
      setError(describeFetchError(unknownError));
    } finally {
      setIsLoading(false);
    }
  }

  function handleLogout() {
    window.localStorage.removeItem("govigyan_token");
    setToken(null);
    setSummary(null);
    setStockTrend([]);
    setFeedBurnRate(null);
    setAlerts([]);
    setAlertsMeta(null);
    setCategoryDistribution([]);
    setItems([]);
    setDepartments([]);
    setItemsListCount(null);
    setDepartmentStockRows([]);
    setDepartmentStockRaw(null);
  }

  async function refreshErpItems() {
    if (!token) {
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    await Promise.all([loadItems(headers), loadDepartments(headers)]);
  }

  async function handleGetItemById() {
    if (!token || !selectedItemId.trim()) {
      setErpMessage("Select an item first.");
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const data = await requestJson(
        `/api/items/${selectedItemId.trim()}`,
        "GET",
        headers,
      );
      const entity = unwrapEntityPayload(data);
      setSelectedItem(toRecord(entity) ?? { value: entity });
      setErpMessage("Item details loaded.");
    } catch (unknownError) {
      setErpMessage(
        unknownError instanceof Error ? unknownError.message : "Failed to fetch item",
      );
    }
  }

  async function handleCreateItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await requestJson("/api/items", "POST", headers, cleanItemPayload(createItemForm));
      setErpMessage("Item created successfully.");
      await refreshErpItems();
    } catch (unknownError) {
      setErpMessage(
        unknownError instanceof Error ? unknownError.message : "Failed to create item",
      );
    }
  }

  async function handleUpdateItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedItemId.trim()) {
      setErpMessage("Select an item before updating.");
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await requestJson(`/api/items/${selectedItemId.trim()}`, "PUT", headers, cleanItemPayload(updateItemForm));
      setErpMessage("Item updated successfully.");
      await refreshErpItems();
    } catch (unknownError) {
      setErpMessage(
        unknownError instanceof Error ? unknownError.message : "Failed to update item",
      );
    }
  }

  async function handleDeleteItem() {
    if (!token || !selectedItemId.trim()) {
      setErpMessage("Select an item before deleting.");
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await requestJson(`/api/items/${selectedItemId.trim()}`, "DELETE", headers);
      setErpMessage("Item deleted successfully.");
      setSelectedItem(null);
      await refreshErpItems();
    } catch (unknownError) {
      setErpMessage(
        unknownError instanceof Error ? unknownError.message : "Failed to delete item",
      );
    }
  }

  async function handleQuantityUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !quantityForm.item_id || !quantityForm.department_id) {
      setErpMessage("Select item and department for quantity update.");
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await requestJson(
        `/api/items/${quantityForm.item_id}/quantity`,
        "PUT",
        headers,
        {
          department_id: quantityForm.department_id,
          quantity: Number(quantityForm.quantity),
        },
      );
      setErpMessage("Item quantity updated.");
      await refreshErpItems();
    } catch (unknownError) {
      setErpMessage(
        unknownError instanceof Error
          ? unknownError.message
          : "Failed to update quantity",
      );
    }
  }

  async function handleThresholdUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !thresholdForm.item_id || !thresholdForm.reorder_level) {
      setErpMessage("Select item and enter reorder level for threshold update.");
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const thresholdBody: Record<string, unknown> = {
        reorder_level: Number(thresholdForm.reorder_level),
      };
      if (thresholdForm.department_id.trim()) {
        thresholdBody.department_id = thresholdForm.department_id.trim();
      }
      await requestJson(
        `/api/items/${thresholdForm.item_id}/threshold`,
        "PUT",
        headers,
        thresholdBody,
      );
      setErpMessage("Item threshold updated.");
    } catch (unknownError) {
      setErpMessage(
        unknownError instanceof Error
          ? unknownError.message
          : "Failed to update threshold",
      );
    }
  }

  async function handleStockMove(
    event: FormEvent<HTMLFormElement>,
    mode: "in" | "out",
  ) {
    event.preventDefault();
    if (!token) return;
    const form = mode === "in" ? stockInForm : stockOutForm;
    if (!form.item_id || !form.department_id || !form.quantity) {
      setErpMessage(`Select item, department, and quantity for stock ${mode}.`);
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const stockBody: Record<string, unknown> = {
        item_id: form.item_id,
        department_id: form.department_id,
        quantity: Number(form.quantity),
      };
      if (form.notes.trim()) {
        stockBody.notes = form.notes.trim();
      }
      if (form.unit_cost.trim()) {
        stockBody.unit_cost = Number(form.unit_cost);
      }
      await requestJson(`/api/stock/${mode}`, "POST", headers, stockBody);
      setErpMessage(`Stock ${mode} transaction completed.`);
      await refreshErpItems();
    } catch (unknownError) {
      setErpMessage(
        unknownError instanceof Error
          ? unknownError.message
          : `Failed stock ${mode} request`,
      );
    }
  }

  async function handleDepartmentStockLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !stockLookupDepartmentId.trim()) {
      setErpMessage("Select a department to fetch stock.");
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${token}` };
      let listForNames = items;
      if (listForNames.length === 0) {
        const parsed = await fetchItemsList(headers);
        listForNames = parsed.items;
        setItems(parsed.items);
        setItemsListCount(parsed.count);
      }
      const nameById = new Map(
        listForNames
          .filter((i) => typeof i.id === "string")
          .map((i) => [i.id as string, i.name ?? "—"] as const),
      );
      const data = await requestJson(
        `/api/v1/inventory/stock?department_id=${encodeURIComponent(
          stockLookupDepartmentId.trim(),
        )}`,
        "GET",
        headers,
      );
      setDepartmentStockRaw(data);

      const { rows: rawRows } = extractRowList(data, [
        "item_id",
        "department_id",
        "quantity",
      ]);
      const enriched = rawRows.map((row) => {
        const r = toRecord(row);
        if (!r) {
          return row;
        }
        const itemId = r.item_id;
        const itemName =
          typeof itemId === "string" ? (nameById.get(itemId) ?? null) : null;
        return { ...r, item_name: itemName };
      });
      setDepartmentStockRows(enriched);

      if (enriched.length > 0) {
        setErpMessage(`Department stock: ${enriched.length} row(s) loaded.`);
      } else {
        const rec = toRecord(data);
        const explicitlyEmpty =
          (Array.isArray(data) && data.length === 0) ||
          (rec !== null &&
            Array.isArray(rec.data) &&
            (rec.data as unknown[]).length === 0);
        setErpMessage(
          explicitlyEmpty
            ? "No stock rows for this department."
            : "Stock response had no parseable rows. Raw JSON from the API is shown below.",
        );
      }
    } catch (unknownError) {
      setErpMessage(
        unknownError instanceof Error
          ? unknownError.message
          : "Failed to fetch department stock",
      );
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-background px-4 py-8 text-foreground">
        <main className="mx-auto w-full max-w-md border border-line bg-surface p-8">
          <h1 className="text-2xl font-semibold text-foreground">
            Govigyan Kendra ERP
          </h1>
          <p className="mt-2 text-sm text-muted">
            Sign in to access dashboard and ERP modules.
          </p>

          <form className="mt-8 space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="mb-2 block text-sm text-muted" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full border border-line bg-white px-3 py-2 text-sm outline-none"
                placeholder="admin@govigyan.in"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-muted" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full border border-line bg-white px-3 py-2 text-sm outline-none"
                placeholder="********"
              />
            </div>

            {error ? (
              <p className="border border-line bg-primary-soft px-3 py-2 text-sm text-foreground">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full border border-primary bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {isLoading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-lg font-semibold">Govigyan Kendra ERP</h1>
            <p className="text-sm text-muted">Welcome, {userName}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="border border-line bg-white px-4 py-2 text-sm text-foreground"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <nav className="mb-6 flex gap-2">
          <button
            type="button"
            onClick={() => setActiveView("dashboard")}
            className={`border px-4 py-2 text-sm ${
              activeView === "dashboard"
                ? "border-primary bg-primary text-white"
                : "border-line bg-white text-foreground"
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setActiveView("erp")}
            className={`border px-4 py-2 text-sm ${
              activeView === "erp"
                ? "border-primary bg-primary text-white"
                : "border-line bg-white text-foreground"
            }`}
          >
            ERP
          </button>
        </nav>

        {activeView === "dashboard" ? (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-xl font-semibold">Inventory Dashboard</h2>
              <div className="flex gap-2">
                {(["7d", "30d", "90d"] as const).map((range) => (
                  <button
                    key={range}
                    type="button"
                    onClick={() => setDashboardRange(range)}
                    className={`border px-3 py-1 text-sm ${
                      dashboardRange === range
                        ? "border-primary bg-primary text-white"
                        : "border-line bg-white text-foreground"
                    }`}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <article className="border border-line bg-white p-4">
                <p className="text-sm text-muted">Total Items</p>
                <p className="mt-2 text-2xl font-semibold">
                  {summary?.total_items ?? "-"}
                </p>
              </article>
              <article className="border border-line bg-white p-4">
                <p className="text-sm text-muted">Low Stock</p>
                <p className="mt-2 text-2xl font-semibold">
                  {summary?.low_stock_count ?? "-"}
                </p>
              </article>
              <article className="border border-line bg-white p-4">
                <p className="text-sm text-muted">Critical Stock</p>
                <p className="mt-2 text-2xl font-semibold">
                  {summary?.critical_stock_count ?? "-"}
                </p>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="border border-line bg-white p-4">
                <h3 className="text-base font-semibold">Stock Trend</h3>
                <p className="mt-1 text-xs text-muted">
                  GET /api/dashboard/stock-trend
                </p>
                <ul className="mt-4 space-y-2">
                  {stockTrend.length === 0 ? (
                    <li className="text-sm text-muted">No trend data available.</li>
                  ) : (
                    stockTrend.slice(0, 12).map((point, index) => (
                      <li
                        key={`${point.date}-${index}`}
                        className="flex items-center justify-between border-b border-line py-1 text-sm"
                      >
                        <span>{point.date}</span>
                        <span className="font-medium">{point.net_change}</span>
                      </li>
                    ))
                  )}
                </ul>
              </article>

              <article className="border border-line bg-white p-4">
                <h3 className="text-base font-semibold">Feed Burn Rate</h3>
                <p className="mt-1 text-xs text-muted">
                  GET /api/dashboard/feed-burn-rate
                </p>
                {!feedBurnRate ? (
                  <p className="mt-4 text-sm text-muted">No burn-rate data available.</p>
                ) : (
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between border-b border-line py-1">
                      <dt className="text-muted">Range</dt>
                      <dd className="font-medium">{feedBurnRate.range ?? dashboardRange}</dd>
                    </div>
                    <div className="flex justify-between border-b border-line py-1">
                      <dt className="text-muted">Total feed consumed</dt>
                      <dd className="font-medium">{feedBurnRate.total_feed_consumed ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between border-b border-line py-1">
                      <dt className="text-muted">Daily burn rate</dt>
                      <dd className="font-medium">{feedBurnRate.daily_burn_rate ?? "—"}</dd>
                    </div>
                  </dl>
                )}
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="border border-line bg-white p-4">
                <h3 className="text-base font-semibold">Inventory Alerts</h3>
                <p className="mt-1 text-xs text-muted">
                  GET /api/dashboard/inventory-alerts?limit=50
                </p>
                {alertsMeta ? (
                  <p className="mt-2 text-xs text-muted">
                    {alertsMeta.count} alerts · {alertsMeta.unread_count} unread
                  </p>
                ) : null}
                <ul className="mt-4 space-y-2">
                  {alerts.length === 0 ? (
                    <li className="text-sm text-muted">No active alerts.</li>
                  ) : (
                    alerts.slice(0, 8).map((alert) => (
                      <li
                        key={alert.id}
                        className="border border-line bg-background px-3 py-2 text-sm"
                      >
                        <p className="font-medium">
                          {alert.alert_type}
                          {alert.is_read ? "" : " · unread"}
                        </p>
                        {alert.message ? (
                          <p className="mt-1 text-xs text-muted">{alert.message}</p>
                        ) : null}
                      </li>
                    ))
                  )}
                </ul>
              </article>

              <article className="border border-line bg-white p-4">
                <h3 className="text-base font-semibold">Category Distribution</h3>
                <p className="mt-1 text-xs text-muted">
                  GET /api/dashboard/category-distribution
                </p>
                <ul className="mt-4 space-y-3">
                  {categoryDistribution.length === 0 ? (
                    <li className="text-sm text-muted">
                      No category distribution data available.
                    </li>
                  ) : (
                    categoryDistribution.slice(0, 8).map((entry, index) => {
                      const maxValue = Math.max(
                        1,
                        ...categoryDistribution.map((item) => item.value),
                      );
                      const width = Math.max(4, (entry.value / maxValue) * 100);

                      return (
                        <li key={`${entry.label}-${index}`} className="text-sm">
                          <div className="mb-1 flex items-center justify-between">
                            <span>{entry.label}</span>
                            <span className="font-medium">{entry.value}</span>
                          </div>
                          <div className="h-2 border border-line bg-white">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${width}%` }}
                            />
                          </div>
                        </li>
                      );
                    })
                  )}
                </ul>
              </article>
            </div>
          </section>
        ) : (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">ERP Inventory</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <article className="border border-line bg-white p-4">
                <h3 className="text-base font-semibold">Item Detail</h3>
                <p className="mt-1 text-xs text-muted">
                  GET /api/items/{"{item_id}"} | DELETE /api/items/{"{item_id}"}
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <select
                    value={selectedItemId}
                    onChange={(event) => {
                      setSelectedItemId(event.target.value);
                      setSelectedItem(null);
                    }}
                    className={`min-w-[12rem] flex-1 ${selectFieldClass}`}
                  >
                    <option value="">Select item…</option>
                    {itemsSortedForSelect.map((item) => (
                      <option key={item.id} value={item.id}>
                        {itemOptionLabel(item)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleGetItemById}
                    className="border border-primary bg-primary px-3 py-2 text-sm text-white"
                  >
                    Get
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteItem}
                    className="border border-line bg-white px-3 py-2 text-sm"
                  >
                    Delete
                  </button>
                </div>
                {itemsSortedForSelect.length === 0 ? (
                  <p className="mt-2 text-xs text-muted">
                    No items loaded — use Refresh below or open Dashboard once to load the
                    catalog.
                  </p>
                ) : null}
                <pre className="mt-3 overflow-auto border border-line bg-background p-3 text-xs text-foreground">
                  {selectedItem ? JSON.stringify(selectedItem, null, 2) : "No item selected."}
                </pre>
              </article>

              <article className="border border-line bg-white p-4">
                <h3 className="text-base font-semibold">Create Item</h3>
                <p className="mt-1 text-xs text-muted">POST /api/items</p>
                <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={handleCreateItem}>
                  <input
                    required
                    placeholder="name"
                    value={createItemForm.name}
                    onChange={(event) =>
                      setCreateItemForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="sku"
                    value={createItemForm.sku}
                    onChange={(event) =>
                      setCreateItemForm((prev) => ({ ...prev, sku: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="category (optional)"
                    value={createItemForm.category}
                    onChange={(event) =>
                      setCreateItemForm((prev) => ({ ...prev, category: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <select
                    value={createItemForm.item_type}
                    onChange={(event) =>
                      setCreateItemForm((prev) => ({ ...prev, item_type: event.target.value }))
                    }
                    className={`border border-line px-3 py-2 text-sm ${selectFieldClass}`}
                  >
                    <option value="feed">feed</option>
                    <option value="raw_material">raw_material</option>
                    <option value="medicine">medicine</option>
                    <option value="equipment">equipment</option>
                    <option value="general">general</option>
                  </select>
                  <input
                    placeholder="unit"
                    value={createItemForm.unit}
                    onChange={(event) =>
                      setCreateItemForm((prev) => ({ ...prev, unit: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="description"
                    value={createItemForm.description}
                    onChange={(event) =>
                      setCreateItemForm((prev) => ({ ...prev, description: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm sm:col-span-2"
                  />
                  <label className="flex items-center gap-2 text-sm text-muted sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={createItemForm.is_active}
                      onChange={(event) =>
                        setCreateItemForm((prev) => ({
                          ...prev,
                          is_active: event.target.checked,
                        }))
                      }
                    />
                    is_active
                  </label>
                  <button
                    type="submit"
                    className="border border-primary bg-primary px-3 py-2 text-sm text-white sm:col-span-2"
                  >
                    Create Item
                  </button>
                </form>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="border border-line bg-white p-4">
                <h3 className="text-base font-semibold">Update Item</h3>
                <p className="mt-1 text-xs text-muted">PUT /api/items/{"{item_id}"}</p>
                <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={handleUpdateItem}>
                  <input
                    required
                    placeholder="name"
                    value={updateItemForm.name}
                    onChange={(event) =>
                      setUpdateItemForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="sku"
                    value={updateItemForm.sku}
                    onChange={(event) =>
                      setUpdateItemForm((prev) => ({ ...prev, sku: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="category (optional)"
                    value={updateItemForm.category}
                    onChange={(event) =>
                      setUpdateItemForm((prev) => ({ ...prev, category: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <select
                    value={updateItemForm.item_type}
                    onChange={(event) =>
                      setUpdateItemForm((prev) => ({ ...prev, item_type: event.target.value }))
                    }
                    className={`border border-line px-3 py-2 text-sm ${selectFieldClass}`}
                  >
                    <option value="feed">feed</option>
                    <option value="raw_material">raw_material</option>
                    <option value="medicine">medicine</option>
                    <option value="equipment">equipment</option>
                    <option value="general">general</option>
                  </select>
                  <input
                    placeholder="unit"
                    value={updateItemForm.unit}
                    onChange={(event) =>
                      setUpdateItemForm((prev) => ({ ...prev, unit: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="description"
                    value={updateItemForm.description}
                    onChange={(event) =>
                      setUpdateItemForm((prev) => ({ ...prev, description: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm sm:col-span-2"
                  />
                  <label className="flex items-center gap-2 text-sm text-muted sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={updateItemForm.is_active}
                      onChange={(event) =>
                        setUpdateItemForm((prev) => ({
                          ...prev,
                          is_active: event.target.checked,
                        }))
                      }
                    />
                    is_active
                  </label>
                  <button
                    type="submit"
                    className="border border-primary bg-primary px-3 py-2 text-sm text-white sm:col-span-2"
                  >
                    Update Item
                  </button>
                </form>
              </article>

              <article className="border border-line bg-white p-4">
                <h3 className="text-base font-semibold">Quantity & Threshold</h3>
                <p className="mt-1 text-xs text-muted">
                  PUT /api/items/{"{item_id}"}/quantity | PUT /api/items/{"{item_id}"}/threshold
                </p>
                <form className="mt-3 grid gap-2" onSubmit={handleQuantityUpdate}>
                  <select
                    value={quantityForm.item_id}
                    onChange={(event) =>
                      setQuantityForm((prev) => ({ ...prev, item_id: event.target.value }))
                    }
                    className={selectFieldClass}
                  >
                    <option value="">Item…</option>
                    {itemsSortedForSelect.map((item) => (
                      <option key={item.id} value={item.id}>
                        {itemOptionLabel(item)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={quantityForm.department_id}
                    onChange={(event) =>
                      setQuantityForm((prev) => ({
                        ...prev,
                        department_id: event.target.value,
                      }))
                    }
                    className={selectFieldClass}
                  >
                    <option value="">Department…</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="quantity"
                    type="number"
                    min="0"
                    step="0.01"
                    value={quantityForm.quantity}
                    onChange={(event) =>
                      setQuantityForm((prev) => ({ ...prev, quantity: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    className="border border-primary bg-primary px-3 py-2 text-sm text-white"
                  >
                    Update Quantity
                  </button>
                </form>
                <form className="mt-4 grid gap-2" onSubmit={handleThresholdUpdate}>
                  <select
                    value={thresholdForm.item_id}
                    onChange={(event) =>
                      setThresholdForm((prev) => ({ ...prev, item_id: event.target.value }))
                    }
                    className={selectFieldClass}
                  >
                    <option value="">Item…</option>
                    {itemsSortedForSelect.map((item) => (
                      <option key={item.id} value={item.id}>
                        {itemOptionLabel(item)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={thresholdForm.department_id}
                    onChange={(event) =>
                      setThresholdForm((prev) => ({
                        ...prev,
                        department_id: event.target.value,
                      }))
                    }
                    className={selectFieldClass}
                  >
                    <option value="">All departments (optional)</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="reorder_level"
                    type="number"
                    min="0"
                    step="0.01"
                    value={thresholdForm.reorder_level}
                    onChange={(event) =>
                      setThresholdForm((prev) => ({
                        ...prev,
                        reorder_level: event.target.value,
                      }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    className="border border-primary bg-primary px-3 py-2 text-sm text-white"
                  >
                    Update Threshold
                  </button>
                </form>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="border border-line bg-white p-4">
                <h3 className="text-base font-semibold">Stock In</h3>
                <p className="mt-1 text-xs text-muted">POST /api/stock/in</p>
                <form className="mt-3 grid gap-2" onSubmit={(event) => handleStockMove(event, "in")}>
                  <select
                    value={stockInForm.item_id}
                    onChange={(event) =>
                      setStockInForm((prev) => ({ ...prev, item_id: event.target.value }))
                    }
                    className={selectFieldClass}
                  >
                    <option value="">Item…</option>
                    {itemsSortedForSelect.map((item) => (
                      <option key={item.id} value={item.id}>
                        {itemOptionLabel(item)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={stockInForm.department_id}
                    onChange={(event) =>
                      setStockInForm((prev) => ({ ...prev, department_id: event.target.value }))
                    }
                    className={selectFieldClass}
                  >
                    <option value="">Department…</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="quantity"
                    type="number"
                    min="0.0001"
                    step="0.01"
                    value={stockInForm.quantity}
                    onChange={(event) =>
                      setStockInForm((prev) => ({ ...prev, quantity: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="unit_cost (optional)"
                    type="number"
                    min="0"
                    step="0.01"
                    value={stockInForm.unit_cost}
                    onChange={(event) =>
                      setStockInForm((prev) => ({ ...prev, unit_cost: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="notes (optional)"
                    value={stockInForm.notes}
                    onChange={(event) =>
                      setStockInForm((prev) => ({ ...prev, notes: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    className="border border-primary bg-primary px-3 py-2 text-sm text-white"
                  >
                    Submit Stock In
                  </button>
                </form>
              </article>

              <article className="border border-line bg-white p-4">
                <h3 className="text-base font-semibold">Stock Out</h3>
                <p className="mt-1 text-xs text-muted">POST /api/stock/out</p>
                <form className="mt-3 grid gap-2" onSubmit={(event) => handleStockMove(event, "out")}>
                  <select
                    value={stockOutForm.item_id}
                    onChange={(event) =>
                      setStockOutForm((prev) => ({ ...prev, item_id: event.target.value }))
                    }
                    className={selectFieldClass}
                  >
                    <option value="">Item…</option>
                    {itemsSortedForSelect.map((item) => (
                      <option key={item.id} value={item.id}>
                        {itemOptionLabel(item)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={stockOutForm.department_id}
                    onChange={(event) =>
                      setStockOutForm((prev) => ({ ...prev, department_id: event.target.value }))
                    }
                    className={selectFieldClass}
                  >
                    <option value="">Department…</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="quantity"
                    type="number"
                    min="0.0001"
                    step="0.01"
                    value={stockOutForm.quantity}
                    onChange={(event) =>
                      setStockOutForm((prev) => ({ ...prev, quantity: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="unit_cost (optional)"
                    type="number"
                    min="0"
                    step="0.01"
                    value={stockOutForm.unit_cost}
                    onChange={(event) =>
                      setStockOutForm((prev) => ({ ...prev, unit_cost: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="notes (optional)"
                    value={stockOutForm.notes}
                    onChange={(event) =>
                      setStockOutForm((prev) => ({ ...prev, notes: event.target.value }))
                    }
                    className="border border-line px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    className="border border-primary bg-primary px-3 py-2 text-sm text-white"
                  >
                    Submit Stock Out
                  </button>
                </form>
              </article>
            </div>

            <article className="border border-line bg-white p-4">
              <h3 className="text-base font-semibold">Department Stock Lookup</h3>
              <p className="mt-1 text-xs text-muted">
                GET /api/v1/inventory/stock?department_id=
              </p>
              <form className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={handleDepartmentStockLookup}>
                <label className="sr-only" htmlFor="dept-stock-select">
                  Department
                </label>
                <select
                  id="dept-stock-select"
                  value={stockLookupDepartmentId}
                  onChange={(event) => setStockLookupDepartmentId(event.target.value)}
                  className={`min-w-[12rem] flex-1 ${selectFieldClass}`}
                  required
                >
                  <option value="">Select department…</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="border border-primary bg-primary px-3 py-2 text-sm text-white"
                >
                  Fetch Stock
                </button>
              </form>
              {departments.length === 0 ? (
                <p className="mt-2 text-xs text-muted">
                  No departments loaded — check API GET /api/v1/inventory/departments or tap
                  Refresh in the item list.
                </p>
              ) : null}
              <pre className="mt-3 overflow-auto border border-line bg-background p-3 text-xs">
                {departmentStockRows.length > 0
                  ? JSON.stringify(departmentStockRows, null, 2)
                  : departmentStockRaw !== null
                    ? JSON.stringify(departmentStockRaw, null, 2)
                    : "Fetch stock for a department to see the response here."}
              </pre>
            </article>

            <div className="overflow-x-auto border border-line bg-white">
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <p className="text-sm font-medium">
                  GET /api/items
                  {itemsListCount !== null ? (
                    <span className="ml-2 text-xs font-normal text-muted">
                      ({itemsListCount} total)
                    </span>
                  ) : null}
                </p>
                <button
                  type="button"
                  onClick={refreshErpItems}
                  className="border border-line bg-white px-3 py-1 text-xs"
                >
                  Refresh
                </button>
              </div>
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-primary-soft text-left">
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Unit</th>
                    <th className="px-3 py-2">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-muted" colSpan={5}>
                        No inventory items available yet.
                      </td>
                    </tr>
                  ) : (
                    items.slice(0, 50).map((item, index) => (
                      <tr key={item.id ?? `${item.sku ?? "item"}-${index}`}>
                        <td className="border-b border-line px-3 py-2">
                          {item.name ?? "-"}
                        </td>
                        <td className="border-b border-line px-3 py-2">
                          {item.sku ?? "-"}
                        </td>
                        <td className="border-b border-line px-3 py-2">
                          {item.item_type ?? item.category ?? "-"}
                        </td>
                        <td className="border-b border-line px-3 py-2">
                          {item.unit ?? "-"}
                        </td>
                        <td className="border-b border-line px-3 py-2">
                          {typeof item.is_active === "boolean"
                            ? item.is_active
                              ? "Yes"
                              : "No"
                            : "-"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {erpMessage ? (
              <p className="border border-line bg-primary-soft px-3 py-2 text-sm">
                {erpMessage}
              </p>
            ) : null}
          </section>
        )}

        {error ? (
          <p className="mt-6 border border-line bg-primary-soft px-3 py-2 text-sm text-foreground">
            {error}
          </p>
        ) : null}

        <div className="mt-6 border border-line bg-white p-4">
          <p className="text-sm text-muted">Connected API Base URL</p>
          <p className="mt-1 text-sm font-medium">{API_BASE}</p>
          <p className="mt-3 text-xs text-muted">
            Auth header in use: {authHeaders.Authorization ? "Bearer token" : "None"}
          </p>
        </div>
      </main>
    </div>
  );
}
