import Airtable from "airtable";
import type { ApiTask, ExportResult } from "@/types";
import { apiFetch } from "./api-client";

function isTransientError(err: any): boolean {
  const status = err?.statusCode || err?.status;
  const msg = String(err?.message || "").toLowerCase();
  if (status === 429 || msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests")) {
    return true;
  }
  if (status >= 500 && status <= 504) {
    return true;
  }
  return false;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 300
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries && isTransientError(err)) {
        await new Promise((res) => setTimeout(res, delayMs * Math.pow(2, attempt)));
      } else {
        throw lastError;
      }
    }
  }
  throw lastError;
}

/**
 * Client-side exporter using the official `airtable` npm package directly.
 * Useful for tests and client-side execution.
 */
export async function exportTasksWithAirtableNpm(
  tasks: ApiTask[],
  projectName: string,
  options: {
    apiKey?: string;
    baseId?: string;
    tableName?: string;
    customAirtableInstance?: any;
  }
): Promise<ExportResult> {
  const env = (import.meta as any).env || {};
  const apiKey = options.apiKey || env.VITE_AIRTABLE_API_KEY;
  const baseId = options.baseId || env.VITE_AIRTABLE_BASE_ID;
  const tableName = options.tableName || "Tasks";

  let airtableClient: any = options.customAirtableInstance;
  if (!airtableClient) {
    if (!apiKey) throw new Error("Airtable API Key is required");
    airtableClient = new Airtable({ apiKey });
  }

  if (!baseId) throw new Error("Airtable Base ID is required");

  const base = airtableClient.base(baseId);
  const table = base(tableName);

  // Fetch existing records for idempotency (match on "Task ID")
  let existingRecords: any[] = [];
  try {
    existingRecords = await retryWithBackoff(() => table.select().all());
  } catch (err) {
    console.warn("Could not query existing Airtable records, proceeding...", err);
  }

  const existingMap = new Map<string, string>();
  for (const rec of existingRecords) {
    const tId = rec.fields?.["Task ID"];
    if (tId) existingMap.set(String(tId), rec.id);
  }

  let exported = 0;
  let failed = 0;
  const errors: Array<{ task_id: string; title: string; error: string }> = [];

  for (const task of tasks) {
    const fields: Record<string, any> = {
      Title: task.title,
      "Task ID": task.id,
      Description: task.description || "",
      Status: task.status,
      Assignee: task.assignee?.name || "",
      Project: projectName,
    };

    try {
      if (existingMap.has(task.id)) {
        const recordId = existingMap.get(task.id)!;
        await retryWithBackoff(() => table.update(recordId, fields));
      } else {
        const newRec: any = await retryWithBackoff(() => table.create(fields));
        existingMap.set(task.id, newRec.id);
      }
      exported++;
    } catch (err: any) {
      failed++;
      errors.push({
        task_id: task.id,
        title: task.title,
        error: err.message || String(err),
      });
    }
  }

  return {
    ok: failed === 0 || exported > 0,
    exported,
    failed,
    total: tasks.length,
    errors,
  };
}

/**
 * Triggers the project task export.
 * Calls the server-side endpoint `POST /api/projects/:id/export`
 * which performs real API calls to Airtable using server credentials.
 */
export async function triggerProjectExport(projectId: string): Promise<ExportResult> {
  return apiFetch<ExportResult>(`/api/projects/${projectId}/export`, {
    method: "POST",
  });
}
