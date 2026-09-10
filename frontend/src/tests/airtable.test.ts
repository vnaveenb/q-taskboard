import { describe, it, expect, beforeEach } from "vitest";
import { MockAirtable } from "@/lib/airtable-mock";
import { exportTasksWithAirtableNpm } from "@/lib/airtable";
import type { ApiTask } from "@/types";

describe("Airtable npm export service (Part 3c)", () => {
  let mockAirtable: MockAirtable;

  beforeEach(() => {
    mockAirtable = new MockAirtable();
  });

  const sampleTasks: ApiTask[] = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      projectId: "proj-1",
      title: "Write design doc",
      description: "Document all endpoints",
      status: "in_progress",
      assigneeId: "user-1",
      createdById: "user-1",
      position: 0,
      createdAt: "2026-09-10T10:00:00Z",
      updatedAt: "2026-09-10T10:00:00Z",
      assignee: { id: "user-1", name: "Meera Iyer", email: "meera@taskboard.dev" },
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      projectId: "proj-1",
      title: "Build Airtable export",
      description: "Integrate official airtable npm SDK",
      status: "todo",
      assigneeId: null,
      createdById: "user-1",
      position: 1,
      createdAt: "2026-09-10T10:00:00Z",
      updatedAt: "2026-09-10T10:00:00Z",
    },
  ];

  it("exports tasks to Airtable table successfully", async () => {
    const result = await exportTasksWithAirtableNpm(sampleTasks, "Launch Project", {
      customAirtableInstance: mockAirtable,
      baseId: "appTest123",
      tableName: "Tasks",
    });

    expect(result.ok).toBe(true);
    expect(result.exported).toBe(2);
    expect(result.failed).toBe(0);

    const records = await mockAirtable.base("appTest123")("Tasks").select().all();
    expect(records.length).toBe(2);
    expect(records[0].fields["Title"]).toBe("Write design doc");
    expect(records[0].fields["Task ID"]).toBe(sampleTasks[0].id);
    expect(records[0].fields["Assignee"]).toBe("Meera Iyer");
  });

  it("handles repeated runs gracefully (idempotent upsert)", async () => {
    // Run 1
    await exportTasksWithAirtableNpm(sampleTasks, "Launch Project", {
      customAirtableInstance: mockAirtable,
      baseId: "appTest123",
      tableName: "Tasks",
    });

    // Run 2 with modified status on task 1
    const modifiedTasks = [...sampleTasks];
    modifiedTasks[0] = { ...modifiedTasks[0], status: "done" };

    const result2 = await exportTasksWithAirtableNpm(modifiedTasks, "Launch Project", {
      customAirtableInstance: mockAirtable,
      baseId: "appTest123",
      tableName: "Tasks",
    });

    expect(result2.ok).toBe(true);
    expect(result2.exported).toBe(2);
    expect(result2.failed).toBe(0);

    const records = await mockAirtable.base("appTest123")("Tasks").select().all();
    // Still exactly 2 records, not duplicated!
    expect(records.length).toBe(2);
    expect(records[0].fields["Status"]).toBe("done");
  });

  it("retries transient 429 rate limits and succeeds", async () => {
    const table = mockAirtable.base("appTest123")("Tasks");
    // Simulate 2 rate-limit errors before succeeding
    table.rateLimitCount = 2;

    const result = await exportTasksWithAirtableNpm([sampleTasks[0]], "Launch Project", {
      customAirtableInstance: mockAirtable,
      baseId: "appTest123",
      tableName: "Tasks",
    });

    expect(result.ok).toBe(true);
    expect(result.exported).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("does not fail the entire export if a single record permanently fails", async () => {
    const table = mockAirtable.base("appTest123")("Tasks");
    // Simulate permanent failure on task 2
    table.failTaskIds.add(sampleTasks[1].id);

    const result = await exportTasksWithAirtableNpm(sampleTasks, "Launch Project", {
      customAirtableInstance: mockAirtable,
      baseId: "appTest123",
      tableName: "Tasks",
    });

    expect(result.ok).toBe(true);
    expect(result.exported).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors?.length).toBe(1);
    expect(result.errors?.[0].task_id).toBe(sampleTasks[1].id);
  });
});
